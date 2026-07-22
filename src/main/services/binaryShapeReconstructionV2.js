'use strict';

const sharp = require('sharp');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pointKey = (x, y) => `${x},${y}`;

function directionCode(start, end) {
  if (end.x > start.x) return 0;
  if (end.y > start.y) return 1;
  if (end.x < start.x) return 2;
  return 3;
}

function squaredDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-9) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator, 0, 1);
  const projectedX = start.x + ratio * dx;
  const projectedY = start.y + ratio * dy;
  return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;
}

function rdp(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    let maximumDistance = toleranceSquared;
    let splitIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = squaredDistance(points[index], points[startIndex], points[endIndex]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        splitIndex = index;
      }
    }
    if (splitIndex >= 0) {
      keep[splitIndex] = 1;
      stack.push([startIndex, splitIndex], [splitIndex, endIndex]);
    }
  }
  return points.filter((_point, index) => keep[index]);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function removeDuplicateAndCollinear(points, tolerance = 0.001) {
  if (points.length < 3) return points.slice();
  let current = [];
  for (const point of points) {
    const previous = current.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > tolerance) current.push({ ...point });
  }
  if (current.length > 1 && Math.hypot(current[0].x - current.at(-1).x, current[0].y - current.at(-1).y) <= tolerance) current.pop();

  for (let pass = 0; pass < 6 && current.length >= 3; pass += 1) {
    const next = [];
    for (let index = 0; index < current.length; index += 1) {
      const previous = current[(index - 1 + current.length) % current.length];
      const point = current[index];
      const following = current[(index + 1) % current.length];
      const cross = (point.x - previous.x) * (following.y - point.y) - (point.y - previous.y) * (following.x - point.x);
      const length = Math.hypot(point.x - previous.x, point.y - previous.y) + Math.hypot(following.x - point.x, following.y - point.y);
      if (Math.abs(cross) > tolerance * Math.max(1, length)) next.push(point);
    }
    if (next.length === current.length || next.length < 3) break;
    current = next;
  }
  return current;
}

function simplifyClosed(points, tolerance) {
  const clean = removeDuplicateAndCollinear(points);
  if (clean.length <= 4) return clean;
  const extremes = [
    clean.reduce((best, point, index) => point.x < clean[best].x ? index : best, 0),
    clean.reduce((best, point, index) => point.x > clean[best].x ? index : best, 0),
    clean.reduce((best, point, index) => point.y < clean[best].y ? index : best, 0),
    clean.reduce((best, point, index) => point.y > clean[best].y ? index : best, 0)
  ];
  let firstIndex = extremes[0];
  let secondIndex = extremes[1];
  let maximum = -1;
  for (const left of extremes) {
    for (const right of extremes) {
      const distance = (clean[left].x - clean[right].x) ** 2 + (clean[left].y - clean[right].y) ** 2;
      if (distance > maximum) {
        maximum = distance;
        firstIndex = left;
        secondIndex = right;
      }
    }
  }
  if (firstIndex > secondIndex) [firstIndex, secondIndex] = [secondIndex, firstIndex];
  const firstPath = clean.slice(firstIndex, secondIndex + 1);
  const secondPath = clean.slice(secondIndex).concat(clean.slice(0, firstIndex + 1));
  return removeDuplicateAndCollinear(
    rdp(firstPath, tolerance).slice(0, -1).concat(rdp(secondPath, tolerance).slice(0, -1)),
    Math.max(0.01, tolerance * 0.08)
  );
}

function clusterValues(values, tolerance) {
  const clusters = [];
  for (const value of values.slice().sort((left, right) => left - right)) {
    const current = clusters.at(-1);
    if (!current || Math.abs(value - current.mean) > tolerance) clusters.push({ mean: value, sum: value, count: 1 });
    else {
      current.sum += value;
      current.count += 1;
      current.mean = current.sum / current.count;
    }
  }
  return clusters;
}

function nearestCluster(value, clusters, tolerance) {
  let result = null;
  let distance = Infinity;
  for (const cluster of clusters) {
    const current = Math.abs(value - cluster.mean);
    if (current <= tolerance && current < distance) {
      distance = current;
      result = cluster.mean;
    }
  }
  return result;
}

function snapDominantAxes(points, options = {}) {
  if (points.length < 3) return { points: points.slice(), horizontalSnaps: 0, verticalSnaps: 0 };
  const angle = (Number(options.angleDegrees) || 1.15) * Math.PI / 180;
  const coordinateTolerance = Number(options.coordinateTolerance) || 1.1;
  const minimumLength = Number(options.minimumLength) || 3;
  const tangent = Math.tan(angle);
  const segments = [];
  const horizontalValues = [];
  const verticalValues = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const horizontal = length >= minimumLength && Math.abs(dy) <= Math.max(0.45, Math.abs(dx) * tangent);
    const vertical = length >= minimumLength && Math.abs(dx) <= Math.max(0.45, Math.abs(dy) * tangent);
    if (horizontal) horizontalValues.push((start.y + end.y) / 2);
    if (vertical) verticalValues.push((start.x + end.x) / 2);
    segments.push({ horizontal, vertical });
  }
  const horizontalClusters = clusterValues(horizontalValues, coordinateTolerance);
  const verticalClusters = clusterValues(verticalValues, coordinateTolerance);
  const suggestions = points.map(() => ({ x: [], y: [] }));
  for (let index = 0; index < segments.length; index += 1) {
    const next = (index + 1) % points.length;
    if (segments[index].horizontal) {
      const value = nearestCluster((points[index].y + points[next].y) / 2, horizontalClusters, coordinateTolerance * 1.25);
      if (value != null) suggestions[index].y.push(value), suggestions[next].y.push(value);
    }
    if (segments[index].vertical) {
      const value = nearestCluster((points[index].x + points[next].x) / 2, verticalClusters, coordinateTolerance * 1.25);
      if (value != null) suggestions[index].x.push(value), suggestions[next].x.push(value);
    }
  }
  let horizontalSnaps = 0;
  let verticalSnaps = 0;
  const snapped = points.map((point, index) => {
    const next = { ...point };
    if (suggestions[index].x.length) {
      const value = suggestions[index].x.reduce((sum, item) => sum + item, 0) / suggestions[index].x.length;
      if (Math.abs(next.x - value) > 1e-6) verticalSnaps += 1;
      next.x = value;
    }
    if (suggestions[index].y.length) {
      const value = suggestions[index].y.reduce((sum, item) => sum + item, 0) / suggestions[index].y.length;
      if (Math.abs(next.y - value) > 1e-6) horizontalSnaps += 1;
      next.y = value;
    }
    return next;
  });
  return { points: removeDuplicateAndCollinear(snapped, 0.02), horizontalSnaps, verticalSnaps };
}

function buildBoundaryEdges(mask, width, height) {
  const edges = [];
  const add = (sx, sy, ex, ey) => {
    const start = { x: sx, y: sy };
    const end = { x: ex, y: ey };
    edges.push({ start, end, direction: directionCode(start, end) });
  };
  const foreground = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!foreground(x, y)) continue;
      if (!foreground(x, y - 1)) add(x, y, x + 1, y);
      if (!foreground(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!foreground(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!foreground(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  return edges;
}

function traceBoundaryLoops(edges) {
  const outgoing = new Map();
  edges.forEach((edge, index) => {
    const key = pointKey(edge.start.x, edge.start.y);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(index);
  });
  const used = new Uint8Array(edges.length);
  const preference = new Map([[1, 0], [0, 1], [3, 2], [2, 3]]);
  const loops = [];
  for (let seed = 0; seed < edges.length; seed += 1) {
    if (used[seed]) continue;
    const first = edges[seed];
    const points = [{ ...first.start }];
    let edgeIndex = seed;
    let guard = 0;
    while (guard++ < edges.length + 8) {
      if (used[edgeIndex]) break;
      used[edgeIndex] = 1;
      const edge = edges[edgeIndex];
      points.push({ ...edge.end });
      if (edge.end.x === first.start.x && edge.end.y === first.start.y) break;
      const candidates = (outgoing.get(pointKey(edge.end.x, edge.end.y)) || []).filter((index) => !used[index]);
      if (!candidates.length) break;
      candidates.sort((left, right) => {
        const leftTurn = (edges[left].direction - edge.direction + 4) % 4;
        const rightTurn = (edges[right].direction - edge.direction + 4) % 4;
        return (preference.get(leftTurn) ?? 9) - (preference.get(rightTurn) ?? 9);
      });
      edgeIndex = candidates[0];
    }
    if (points.length >= 5 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) {
      points.pop();
      loops.push(points);
    }
  }
  return loops;
}

function buildMaskFromRaw(data, info) {
  const luminance = new Uint8Array(info.width * info.height);
  let dark = 0;
  let light = 0;
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const offset = pixel * info.channels;
    const red = data[offset];
    const green = data[offset + 1] ?? red;
    const blue = data[offset + 2] ?? red;
    const value = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    luminance[pixel] = value;
    if (value < 128) dark += 1;
    else light += 1;
  }
  const foregroundDark = dark <= light;
  const mask = new Uint8Array(luminance.length);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) mask[pixel] = foregroundDark ? +(luminance[pixel] < 128) : +(luminance[pixel] >= 128);
  return { mask, foregroundDark, darkPixels: dark, lightPixels: light };
}

function rectilinearRatio(points) {
  let rectilinear = 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    total += length;
    if (dx <= 0.45 || dy <= 0.45) rectilinear += length;
  }
  return total ? rectilinear / total : 0;
}

function pointsToPath(points) {
  if (points.length < 3) return '';
  const format = (value) => String(Number(Number(value).toFixed(3)) || 0);
  return `M${format(points[0].x)} ${format(points[0].y)}${points.slice(1).map((point) => `L${format(point.x)} ${format(point.y)}`).join('')}Z`;
}

async function reconstructBinarySvg(inputPath, options = {}) {
  const raw = await sharp(inputPath, { failOn: 'none' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const maskInfo = buildMaskFromRaw(raw.data, raw.info);
  const edges = buildBoundaryEdges(maskInfo.mask, raw.info.width, raw.info.height);
  const loops = traceBoundaryLoops(edges);
  const maximum = Math.max(raw.info.width, raw.info.height);
  const baseTolerance = Number(options.tolerance) || clamp(maximum * 0.00058, 0.46, 0.95);
  const processed = [];
  let sourceNodes = 0;
  let simplifiedNodes = 0;
  let horizontalSnaps = 0;
  let verticalSnaps = 0;
  for (const loop of loops) {
    const area = Math.abs(polygonArea(loop));
    if (area < 2.5) continue;
    sourceNodes += loop.length;
    const bounds = boundsOf(loop);
    const small = Math.max(bounds.width, bounds.height) <= Math.max(90, maximum * 0.09);
    const simplified = simplifyClosed(loop, small ? Math.min(baseTolerance, 0.54) : baseTolerance);
    const ratio = rectilinearRatio(simplified);
    const snapped = snapDominantAxes(simplified, {
      angleDegrees: ratio >= 0.58 ? 1.35 : 0.75,
      coordinateTolerance: ratio >= 0.58 ? 1.05 : 0.65,
      minimumLength: small ? 2 : 3
    });
    const points = removeDuplicateAndCollinear(snapped.points, 0.025);
    if (points.length < 3 || Math.abs(polygonArea(points)) < 2) continue;
    simplifiedNodes += points.length;
    horizontalSnaps += snapped.horizontalSnaps;
    verticalSnaps += snapped.verticalSnaps;
    processed.push({ points, area: polygonArea(points), rectilinearRatio: ratio });
  }
  processed.sort((left, right) => Math.abs(right.area) - Math.abs(left.area));
  const pathData = processed.map((item) => pointsToPath(item.points)).filter(Boolean).join('');
  const width = Number(options.outputWidth) || raw.info.width;
  const height = Number(options.outputHeight) || raw.info.height;
  const fill = maskInfo.foregroundDark ? '#000' : '#fff';
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${raw.info.width} ${raw.info.height}"><path fill="${fill}" fill-rule="evenodd" d="${pathData}"/></svg>`,
    stats: {
      width: raw.info.width,
      height: raw.info.height,
      foregroundDark: maskInfo.foregroundDark,
      darkPixels: maskInfo.darkPixels,
      lightPixels: maskInfo.lightPixels,
      edgeCount: edges.length,
      rawLoopCount: loops.length,
      loopCount: processed.length,
      sourceNodes,
      simplifiedNodes,
      nodeReductionPercent: sourceNodes ? Number(((1 - simplifiedNodes / sourceNodes) * 100).toFixed(2)) : 0,
      horizontalSnaps,
      verticalSnaps,
      tolerance: baseTolerance,
      rectilinearLoops: processed.filter((item) => item.rectilinearRatio >= 0.58).length
    }
  };
}

function connectedComponents(mask, width, height, minimumPixels = 4) {
  const labels = new Int32Array(mask.length);
  const components = [];
  const queue = new Int32Array(mask.length);
  let nextLabel = 1;
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || labels[seed]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    labels[seed] = nextLabel;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      size += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbours = [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1];
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && mask[neighbour] && !labels[neighbour]) {
          labels[neighbour] = nextLabel;
          queue[tail++] = neighbour;
        }
      }
    }
    if (size >= minimumPixels) {
      components.push({ label: nextLabel, size, minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 });
      nextLabel += 1;
    } else {
      for (let index = 0; index < tail; index += 1) labels[queue[index]] = 0;
    }
  }
  return { labels, components };
}

function binaryMaskFromRgb(data, info) {
  let dark = 0;
  let light = 0;
  const values = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * info.channels;
    const red = data[offset];
    const green = data[offset + 1] ?? red;
    const blue = data[offset + 2] ?? red;
    const value = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    values[pixel] = value;
    if (value < 128) dark += 1;
    else light += 1;
  }
  const foregroundDark = dark <= light;
  const mask = new Uint8Array(values.length);
  for (let pixel = 0; pixel < values.length; pixel += 1) mask[pixel] = foregroundDark ? +(values[pixel] < 128) : +(values[pixel] >= 128);
  return mask;
}

function percentile(values, fraction) {
  if (!values.length) return 100;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

function compareBinaryComponents(sourceData, renderedData, info, options = {}) {
  const sourceMask = binaryMaskFromRgb(sourceData, info);
  const renderedMask = binaryMaskFromRgb(renderedData, info);
  const minimumPixels = Number(options.minimumPixels) || Math.max(4, Math.round(info.width * info.height * 0.000006));
  const source = connectedComponents(sourceMask, info.width, info.height, minimumPixels);
  const rendered = connectedComponents(renderedMask, info.width, info.height, minimumPixels);
  const overlaps = new Map();
  for (let pixel = 0; pixel < sourceMask.length; pixel += 1) {
    const sourceLabel = source.labels[pixel];
    const renderedLabel = rendered.labels[pixel];
    if (!sourceLabel || !renderedLabel) continue;
    const key = `${sourceLabel}:${renderedLabel}`;
    overlaps.set(key, (overlaps.get(key) || 0) + 1);
  }
  const results = source.components.map((component) => {
    let best = null;
    let intersection = 0;
    for (const candidate of rendered.components) {
      const overlap = overlaps.get(`${component.label}:${candidate.label}`) || 0;
      if (overlap > intersection) best = candidate, intersection = overlap;
    }
    const renderedSize = best?.size || 0;
    const union = component.size + renderedSize - intersection;
    return {
      sourceLabel: component.label,
      renderedLabel: best?.label || null,
      iou: Number((union ? intersection / union * 100 : 0).toFixed(2)),
      recall: Number((component.size ? intersection / component.size * 100 : 0).toFixed(2)),
      precision: Number((renderedSize ? intersection / renderedSize * 100 : 0).toFixed(2)),
      size: component.size,
      bounds: { x: component.minX, y: component.minY, width: component.width, height: component.height }
    };
  });
  const scores = results.map((item) => item.iou);
  const sizeTotal = results.reduce((sum, item) => sum + item.size, 0);
  const weighted = results.reduce((sum, item) => sum + item.iou * item.size, 0) / Math.max(1, sizeTotal);
  return {
    sourceComponentCount: source.components.length,
    renderedComponentCount: rendered.components.length,
    worstComponentIoU: Number((scores.length ? Math.min(...scores) : 100).toFixed(2)),
    p10ComponentIoU: Number(percentile(scores, 0.1).toFixed(2)),
    medianComponentIoU: Number(percentile(scores, 0.5).toFixed(2)),
    weightedComponentIoU: Number(weighted.toFixed(2)),
    unmatchedSourceComponents: results.filter((item) => item.renderedLabel == null).length,
    worstComponents: results.slice().sort((left, right) => left.iou - right.iou).slice(0, 8)
  };
}

module.exports = {
  buildBoundaryEdges,
  buildMaskFromRaw,
  compareBinaryComponents,
  connectedComponents,
  reconstructBinarySvg,
  removeDuplicateAndCollinear,
  rdp,
  simplifyClosed,
  snapDominantAxes,
  traceBoundaryLoops
};