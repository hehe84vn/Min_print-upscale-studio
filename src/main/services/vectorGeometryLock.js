'use strict';

const COMMAND_PARAMS = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function fmt(value, precision = 3) {
  const rounded = Number(Number(value).toFixed(precision));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
function distancePointToLine(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}
function projectionRatio(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denom = dx * dx + dy * dy;
  if (denom < 1e-9) return 0;
  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom;
}
function nearLinearControl(points, start, end, tolerance) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < tolerance * 1.5) return false;
  return points.every((point) => (
    distancePointToLine(point, start, end) <= tolerance
    && projectionRatio(point, start, end) >= -0.08
    && projectionRatio(point, start, end) <= 1.08
  ));
}
function tokenizePathData(value) {
  return String(value || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
}
function parsePathData(value) {
  const tokens = tokenizePathData(value);
  const segments = [];
  let index = 0;
  let command = null;
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  let previousCommand = null;
  let previousCubicControl = null;
  let previousQuadraticControl = null;

  const numberAt = (position) => {
    const value = Number(tokens[position]);
    if (!Number.isFinite(value)) throw new Error(`Invalid SVG path number at ${position}`);
    return value;
  };

  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) {
      command = tokens[index];
      index += 1;
    } else if (!command) {
      throw new Error('SVG path data is missing an initial command.');
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;
    const count = COMMAND_PARAMS[upper];
    if (count == null) throw new Error(`Unsupported SVG command: ${command}`);

    if (upper === 'Z') {
      segments.push({ type: 'Z', start: { ...current }, end: { ...subpathStart } });
      current = { ...subpathStart };
      previousCommand = 'Z';
      previousCubicControl = null;
      previousQuadraticControl = null;
      command = null;
      continue;
    }

    if (index + count > tokens.length) break;
    const params = Array.from({ length: count }, (_, offset) => numberAt(index + offset));
    index += count;
    const absolutePoint = (x, y) => relative ? { x: current.x + x, y: current.y + y } : { x, y };
    const start = { ...current };

    if (upper === 'M') {
      const end = absolutePoint(params[0], params[1]);
      segments.push({ type: 'M', start, end });
      current = end;
      subpathStart = { ...end };
      previousCubicControl = null;
      previousQuadraticControl = null;
      previousCommand = 'M';
      command = relative ? 'l' : 'L';
      continue;
    }
    if (upper === 'L') {
      const end = absolutePoint(params[0], params[1]);
      segments.push({ type: 'L', start, end });
      current = end;
    } else if (upper === 'H') {
      const end = { x: relative ? current.x + params[0] : params[0], y: current.y };
      segments.push({ type: 'L', start, end });
      current = end;
    } else if (upper === 'V') {
      const end = { x: current.x, y: relative ? current.y + params[0] : params[0] };
      segments.push({ type: 'L', start, end });
      current = end;
    } else if (upper === 'C') {
      const c1 = absolutePoint(params[0], params[1]);
      const c2 = absolutePoint(params[2], params[3]);
      const end = absolutePoint(params[4], params[5]);
      segments.push({ type: 'C', start, c1, c2, end });
      current = end;
      previousCubicControl = c2;
    } else if (upper === 'S') {
      const c1 = ['C', 'S'].includes(previousCommand) && previousCubicControl
        ? { x: 2 * current.x - previousCubicControl.x, y: 2 * current.y - previousCubicControl.y }
        : { ...current };
      const c2 = absolutePoint(params[0], params[1]);
      const end = absolutePoint(params[2], params[3]);
      segments.push({ type: 'C', start, c1, c2, end });
      current = end;
      previousCubicControl = c2;
    } else if (upper === 'Q') {
      const c = absolutePoint(params[0], params[1]);
      const end = absolutePoint(params[2], params[3]);
      segments.push({ type: 'Q', start, c, end });
      current = end;
      previousQuadraticControl = c;
    } else if (upper === 'T') {
      const c = ['Q', 'T'].includes(previousCommand) && previousQuadraticControl
        ? { x: 2 * current.x - previousQuadraticControl.x, y: 2 * current.y - previousQuadraticControl.y }
        : { ...current };
      const end = absolutePoint(params[0], params[1]);
      segments.push({ type: 'Q', start, c, end });
      current = end;
      previousQuadraticControl = c;
    } else if (upper === 'A') {
      const end = absolutePoint(params[5], params[6]);
      segments.push({ type: 'A', start, rx: Math.abs(params[0]), ry: Math.abs(params[1]), rotation: params[2], largeArc: params[3] ? 1 : 0, sweep: params[4] ? 1 : 0, end });
      current = end;
    }

    previousCommand = upper;
    if (!['C', 'S'].includes(upper)) previousCubicControl = null;
    if (!['Q', 'T'].includes(upper)) previousQuadraticControl = null;
  }
  return segments;
}

function angleDifferenceDegrees(a, b) {
  let difference = Math.abs(a - b) % 180;
  if (difference > 90) difference = 180 - difference;
  return difference;
}
function direction(start, end) { return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI; }

function cleanPathSegments(segments, options = {}) {
  const tolerance = Number(options.lineTolerance) || 1;
  const axisTolerance = Number(options.axisTolerance) || Math.max(0.45, tolerance * 0.75);
  const axisAngle = Number(options.axisAngleDegrees) || 1.6;
  const collinearAngle = Number(options.collinearAngleDegrees) || 1.2;
  const output = [];
  const stats = { curvesConvertedToLines: 0, axisSnaps: 0, collinearNodesRemoved: 0 };
  let current = { x: 0, y: 0 };

  const snapLine = (start, end) => {
    const next = { ...end };
    const dx = next.x - start.x;
    const dy = next.y - start.y;
    const angle = Math.abs(direction(start, next));
    const horizontalAngle = Math.min(angle, Math.abs(180 - angle));
    const verticalAngle = Math.abs(90 - angle);
    if (Math.abs(dy) <= axisTolerance || horizontalAngle <= axisAngle) {
      if (Math.abs(next.y - start.y) > 1e-9) stats.axisSnaps += 1;
      next.y = start.y;
    } else if (Math.abs(dx) <= axisTolerance || verticalAngle <= axisAngle) {
      if (Math.abs(next.x - start.x) > 1e-9) stats.axisSnaps += 1;
      next.x = start.x;
    }
    return next;
  };

  for (const original of segments) {
    if (original.type === 'M') {
      const segment = { ...original, start: { ...current }, end: { ...original.end } };
      output.push(segment);
      current = { ...segment.end };
      continue;
    }
    if (original.type === 'Z') {
      output.push({ type: 'Z', start: { ...current }, end: { ...original.end } });
      current = { ...original.end };
      continue;
    }
    let segment = { ...original, start: { ...current } };
    if (segment.type === 'C' && nearLinearControl([segment.c1, segment.c2], segment.start, segment.end, tolerance)) {
      segment = { type: 'L', start: segment.start, end: segment.end };
      stats.curvesConvertedToLines += 1;
    } else if (segment.type === 'Q' && nearLinearControl([segment.c], segment.start, segment.end, tolerance)) {
      segment = { type: 'L', start: segment.start, end: segment.end };
      stats.curvesConvertedToLines += 1;
    }
    if (segment.type === 'L') segment.end = snapLine(segment.start, segment.end);

    const previous = output.at(-1);
    if (segment.type === 'L' && previous?.type === 'L') {
      const previousDirection = direction(previous.start, previous.end);
      const nextDirection = direction(segment.start, segment.end);
      const aligned = angleDifferenceDegrees(previousDirection, nextDirection) <= collinearAngle;
      const forward = (previous.end.x - previous.start.x) * (segment.end.x - segment.start.x)
        + (previous.end.y - previous.start.y) * (segment.end.y - segment.start.y) > 0;
      const junctionGap = Math.hypot(previous.end.x - segment.start.x, previous.end.y - segment.start.y);
      if (aligned && forward && junctionGap <= tolerance * 0.25) {
        previous.end = snapLine(previous.start, segment.end);
        current = { ...previous.end };
        stats.collinearNodesRemoved += 1;
        continue;
      }
    }

    output.push(segment);
    current = { ...segment.end };
  }
  return { segments: output, stats };
}

function serializePathData(segments, precision = 3) {
  const parts = [];
  for (const segment of segments) {
    if (segment.type === 'M') parts.push(`M${fmt(segment.end.x, precision)} ${fmt(segment.end.y, precision)}`);
    else if (segment.type === 'L') parts.push(`L${fmt(segment.end.x, precision)} ${fmt(segment.end.y, precision)}`);
    else if (segment.type === 'C') parts.push(`C${fmt(segment.c1.x, precision)} ${fmt(segment.c1.y, precision)} ${fmt(segment.c2.x, precision)} ${fmt(segment.c2.y, precision)} ${fmt(segment.end.x, precision)} ${fmt(segment.end.y, precision)}`);
    else if (segment.type === 'Q') parts.push(`Q${fmt(segment.c.x, precision)} ${fmt(segment.c.y, precision)} ${fmt(segment.end.x, precision)} ${fmt(segment.end.y, precision)}`);
    else if (segment.type === 'A') parts.push(`A${fmt(segment.rx, precision)} ${fmt(segment.ry, precision)} ${fmt(segment.rotation, precision)} ${segment.largeArc} ${segment.sweep} ${fmt(segment.end.x, precision)} ${fmt(segment.end.y, precision)}`);
    else if (segment.type === 'Z') parts.push('Z');
  }
  return parts.join('');
}

function parseSvgSize(svg) {
  const viewBox = String(svg).match(/\bviewBox=["']\s*([-+.\deE]+)[ ,]+([-+.\deE]+)[ ,]+([-+.\deE]+)[ ,]+([-+.\deE]+)\s*["']/i);
  if (viewBox) return { width: Math.abs(Number(viewBox[3])) || 1000, height: Math.abs(Number(viewBox[4])) || 1000 };
  const width = Number(String(svg).match(/\bwidth=["']([-+.\deE]+)/i)?.[1]);
  const height = Number(String(svg).match(/\bheight=["']([-+.\deE]+)/i)?.[1]);
  return { width: width || 1000, height: height || 1000 };
}
function normalizeMonochromePaint(svg) {
  const colors = new Set();
  const namedGray = { black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192] };
  const replace = (match, attribute, quote, value) => {
    const color = value.trim().toLowerCase();
    if (['none', 'currentcolor'].includes(color)) return match;
    let rgb = namedGray[color] || null;
    if (/^#[0-9a-f]{3}$/i.test(color)) rgb = color.slice(1).split('').map((digit) => parseInt(digit + digit, 16));
    else if (/^#[0-9a-f]{6}$/i.test(color)) rgb = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
    else {
      const parsed = color.match(/^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/i);
      if (parsed) rgb = parsed.slice(1).map(Number);
    }
    if (!rgb) { colors.add(color); return match; }
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    const normalized = chroma <= 24 ? (luminance < 128 ? '#000' : '#fff') : color;
    colors.add(normalized);
    return `${attribute}=${quote}${normalized}${quote}`;
  };
  const output = String(svg).replace(/\b(fill|stroke)=(["'])([^"']+)\2/gi, replace);
  return { svg: output, colors: [...colors] };
}

function inspectPathGeometry(svg) {
  let lineCount = 0;
  let curveCount = 0;
  let arcCount = 0;
  let nearLinearCurveCount = 0;
  const size = parseSvgSize(svg);
  const tolerance = Math.max(0.5, Math.max(size.width, size.height) * 0.0006);
  for (const match of String(svg).matchAll(/\bd=(["'])([^"']+)\1/gi)) {
    let segments;
    try { segments = parsePathData(match[2]); } catch { continue; }
    for (const segment of segments) {
      if (segment.type === 'L') lineCount += 1;
      else if (segment.type === 'C') {
        curveCount += 1;
        if (nearLinearControl([segment.c1, segment.c2], segment.start, segment.end, tolerance)) nearLinearCurveCount += 1;
      } else if (segment.type === 'Q') {
        curveCount += 1;
        if (nearLinearControl([segment.c], segment.start, segment.end, tolerance)) nearLinearCurveCount += 1;
      } else if (segment.type === 'A') arcCount += 1;
    }
  }
  const geometricSegments = lineCount + curveCount + arcCount;
  return {
    lineCount, curveCount, arcCount, nearLinearCurveCount,
    straightnessScore: Number((100 * (1 - nearLinearCurveCount / Math.max(1, geometricSegments))).toFixed(2))
  };
}

function applyGeometryLockToSvg(svg, options = {}) {
  const size = parseSvgSize(svg);
  const maximum = Math.max(size.width, size.height);
  const lineTolerance = Number(options.lineTolerance) || Math.max(0.55, maximum * 0.00065);
  const axisTolerance = Number(options.axisTolerance) || Math.max(0.4, maximum * 0.0004);
  const aggregate = { pathCount: 0, curvesConvertedToLines: 0, axisSnaps: 0, collinearNodesRemoved: 0, parseErrors: 0 };
  let output = String(svg).replace(/\bd=(["'])([^"']+)\1/gi, (match, quote, data) => {
    try {
      const parsed = parsePathData(data);
      const cleaned = cleanPathSegments(parsed, { lineTolerance, axisTolerance, axisAngleDegrees: options.axisAngleDegrees || 1.8, collinearAngleDegrees: options.collinearAngleDegrees || 1.25 });
      aggregate.pathCount += 1;
      aggregate.curvesConvertedToLines += cleaned.stats.curvesConvertedToLines;
      aggregate.axisSnaps += cleaned.stats.axisSnaps;
      aggregate.collinearNodesRemoved += cleaned.stats.collinearNodesRemoved;
      return `d=${quote}${serializePathData(cleaned.segments, options.pathPrecision || 3)}${quote}`;
    } catch {
      aggregate.parseErrors += 1;
      return match;
    }
  });
  const paint = normalizeMonochromePaint(output);
  output = paint.svg;
  return { svg: output, stats: { ...aggregate, lineTolerance, axisTolerance, normalizedColors: paint.colors, geometry: inspectPathGeometry(output) } };
}

function luminanceValue(data, offset, channels) {
  const red = data[offset];
  const green = data[offset + 1] ?? red;
  const blue = data[offset + 2] ?? red;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
function grayscaleBuffer(data, info) {
  const pixels = info.width * info.height;
  const gray = new Float32Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * info.channels;
    gray[pixel] = luminanceValue(data, offset, info.channels);
  }
  return gray;
}
function rasterGeometrySignature(data, info) {
  const width = info.width;
  const height = info.height;
  const gray = grayscaleBuffer(data, info);
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const magnitude = new Float32Array(width * height);
  const histogram = new Float64Array(12);
  let edgeCount = 0;
  let axisAligned = 0;
  let maximumMagnitude = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const a = gray[index - width - 1];
      const b = gray[index - width];
      const c = gray[index - width + 1];
      const d = gray[index - 1];
      const f = gray[index + 1];
      const g = gray[index + width - 1];
      const h = gray[index + width];
      const i = gray[index + width + 1];
      const sx = -a + c - 2 * d + 2 * f - g + i;
      const sy = -a - 2 * b - c + g + 2 * h + i;
      const mag = Math.hypot(sx, sy);
      gx[index] = sx;
      gy[index] = sy;
      magnitude[index] = mag;
      if (mag > maximumMagnitude) maximumMagnitude = mag;
    }
  }

  const edgeThreshold = Math.max(70, maximumMagnitude * 0.18);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (magnitude[index] < edgeThreshold) continue;
      let angle = Math.atan2(gy[index], gx[index]);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      const bin = Math.min(histogram.length - 1, Math.floor((angle / Math.PI) * histogram.length));
      histogram[bin] += magnitude[index];
      edgeCount += 1;
      const degrees = angle * 180 / Math.PI;
      const axisDistance = Math.min(degrees, Math.abs(90 - degrees), Math.abs(180 - degrees));
      if (axisDistance <= 7) axisAligned += 1;
    }
  }
  const histogramTotal = histogram.reduce((sum, value) => sum + value, 0) || 1;
  const normalizedHistogram = [...histogram].map((value) => value / histogramTotal);

  const responses = [];
  let maxCornerResponse = 0;
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          const index = (y + yy) * width + x + xx;
          sxx += gx[index] * gx[index];
          syy += gy[index] * gy[index];
          sxy += gx[index] * gy[index];
        }
      }
      const trace = sxx + syy;
      const determinant = sxx * syy - sxy * sxy;
      const response = determinant - 0.05 * trace * trace;
      if (response > 0) {
        responses.push({ x, y, response });
        if (response > maxCornerResponse) maxCornerResponse = response;
      }
    }
  }
  const cornerThreshold = maxCornerResponse * 0.08;
  const sorted = responses.filter((item) => item.response >= cornerThreshold).sort((a, b) => b.response - a.response);
  const corners = [];
  const occupied = new Uint8Array(width * height);
  const radius = 4;
  for (const candidate of sorted) {
    let blocked = false;
    for (let yy = Math.max(0, candidate.y - radius); yy <= Math.min(height - 1, candidate.y + radius) && !blocked; yy += 1) {
      for (let xx = Math.max(0, candidate.x - radius); xx <= Math.min(width - 1, candidate.x + radius); xx += 1) {
        if (occupied[yy * width + xx]) { blocked = true; break; }
      }
    }
    if (blocked) continue;
    corners.push(candidate);
    occupied[candidate.y * width + candidate.x] = 1;
    if (corners.length >= 1600) break;
  }

  return {
    histogram: normalizedHistogram,
    edgeCount,
    axisAlignedRatio: edgeCount ? axisAligned / edgeCount : 0,
    corners
  };
}
function matchCornerSets(sourceCorners, renderedCorners, radius = 5) {
  if (!sourceCorners.length && !renderedCorners.length) return 100;
  const used = new Uint8Array(renderedCorners.length);
  let matches = 0;
  const radiusSquared = radius * radius;
  for (const source of sourceCorners) {
    let best = -1;
    let bestDistance = radiusSquared + 1;
    for (let index = 0; index < renderedCorners.length; index += 1) {
      if (used[index]) continue;
      const rendered = renderedCorners[index];
      const distance = (source.x - rendered.x) ** 2 + (source.y - rendered.y) ** 2;
      if (distance <= radiusSquared && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    if (best >= 0) {
      used[best] = 1;
      matches += 1;
    }
  }
  const precision = matches / Math.max(1, renderedCorners.length);
  const recall = matches / Math.max(1, sourceCorners.length);
  return precision + recall ? (2 * precision * recall) / (precision + recall) * 100 : 0;
}
function compareRasterGeometry(sourceData, renderedData, info) {
  const source = rasterGeometrySignature(sourceData, info);
  const rendered = rasterGeometrySignature(renderedData, info);
  const histogramDistance = source.histogram.reduce((sum, value, index) => sum + Math.abs(value - rendered.histogram[index]), 0);
  const orientationAgreement = clamp(100 * (1 - histogramDistance / 2), 0, 100);
  const axisAgreement = clamp(100 * (1 - Math.abs(source.axisAlignedRatio - rendered.axisAlignedRatio)), 0, 100);
  const cornerPreservation = matchCornerSets(source.corners, rendered.corners, 5);
  return {
    orientationAgreement: Number(orientationAgreement.toFixed(2)),
    axisAgreement: Number(axisAgreement.toFixed(2)),
    cornerPreservation: Number(cornerPreservation.toFixed(2)),
    sourceCornerCount: source.corners.length,
    renderedCornerCount: rendered.corners.length,
    sourceAxisAlignedRatio: Number((source.axisAlignedRatio * 100).toFixed(2)),
    renderedAxisAlignedRatio: Number((rendered.axisAlignedRatio * 100).toFixed(2))
  };
}

module.exports = {
  applyGeometryLockToSvg,
  cleanPathSegments,
  compareRasterGeometry,
  inspectPathGeometry,
  normalizeMonochromePaint,
  parsePathData,
  parseSvgSize,
  rasterGeometrySignature,
  serializePathData,
  tokenizePathData
};