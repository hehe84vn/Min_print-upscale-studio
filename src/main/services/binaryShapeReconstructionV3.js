'use strict';

const sharp = require('sharp');
const base = require('./binaryShapeReconstructionV2');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

function perimeter(points) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return total;
}

function rectilinearRatio(points) {
  let rectilinear = 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const dx = Math.abs(next.x - current.x);
    const dy = Math.abs(next.y - current.y);
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    total += length;
    if (dx <= 0.45 || dy <= 0.45) rectilinear += length;
  }
  return total ? rectilinear / total : 0;
}

function turningProfile(points) {
  if (points.length < 4) return { sharpRatio: 1, smoothRatio: 0, meanTurn: 180 };
  let sharp = 0;
  let smooth = 0;
  let totalTurn = 0;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const ax = previous.x - current.x;
    const ay = previous.y - current.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const denominator = Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by));
    const angle = Math.acos(clamp((ax * bx + ay * by) / denominator, -1, 1)) * 180 / Math.PI;
    const turn = 180 - angle;
    totalTurn += turn;
    if (turn >= 28) sharp += 1;
    if (turn <= 12) smooth += 1;
  }
  return {
    sharpRatio: sharp / points.length,
    smoothRatio: smooth / points.length,
    meanTurn: totalTurn / points.length
  };
}

function format(value) {
  const rounded = Number(Number(value).toFixed(3));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function polygonPath(points) {
  if (points.length < 3) return '';
  return `M${format(points[0].x)} ${format(points[0].y)}${points.slice(1).map((point) => `L${format(point.x)} ${format(point.y)}`).join('')}Z`;
}

function catmullRomPath(points, tension = 0.82) {
  if (points.length < 4) return polygonPath(points);
  const parts = [`M${format(points[0].x)} ${format(points[0].y)}`];
  const scale = tension / 6;
  for (let index = 0; index < points.length; index += 1) {
    const p0 = points[(index - 1 + points.length) % points.length];
    const p1 = points[index];
    const p2 = points[(index + 1) % points.length];
    const p3 = points[(index + 2) % points.length];
    const c1 = { x: p1.x + (p2.x - p0.x) * scale, y: p1.y + (p2.y - p0.y) * scale };
    const c2 = { x: p2.x - (p3.x - p1.x) * scale, y: p2.y - (p3.y - p1.y) * scale };
    parts.push(`C${format(c1.x)} ${format(c1.y)} ${format(c2.x)} ${format(c2.y)} ${format(p2.x)} ${format(p2.y)}`);
  }
  parts.push('Z');
  return parts.join('');
}

function classifyContour(points, ratio, bounds) {
  const profile = turningProfile(points);
  const density = points.length / Math.max(1, perimeter(points));
  const small = Math.max(bounds.width, bounds.height) <= 90;
  const geometric = ratio >= 0.62
    || points.length <= 12
    || profile.sharpRatio >= 0.34
    || (small && points.length <= 18);
  const curved = !geometric && profile.smoothRatio >= 0.42 && density >= 0.035;
  return { type: curved ? 'curve' : 'polygon', profile, density };
}

async function reconstructBinarySvg(inputPath, options = {}) {
  const raw = await sharp(inputPath, { failOn: 'none' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const maskInfo = base.buildMaskFromRaw(raw.data, raw.info);
  const edges = base.buildBoundaryEdges(maskInfo.mask, raw.info.width, raw.info.height);
  const loops = base.traceBoundaryLoops(edges);
  const maximum = Math.max(raw.info.width, raw.info.height);
  const baseTolerance = Number(options.tolerance) || clamp(maximum * 0.00062, 0.5, 1.05);
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
    const simplified = base.simplifyClosed(loop, small ? Math.min(baseTolerance, 0.56) : baseTolerance);
    const ratio = rectilinearRatio(simplified);
    const classification = classifyContour(simplified, ratio, bounds);
    let points = simplified;
    let snaps = { horizontalSnaps: 0, verticalSnaps: 0 };

    if (classification.type === 'polygon') {
      const snapped = base.snapDominantAxes(simplified, {
        angleDegrees: ratio >= 0.58 ? 1.25 : 0.55,
        coordinateTolerance: ratio >= 0.58 ? 1.0 : 0.5,
        minimumLength: small ? 2 : 3
      });
      points = base.removeDuplicateAndCollinear(snapped.points, 0.025);
      snaps = snapped;
    } else {
      points = base.removeDuplicateAndCollinear(simplified, 0.015);
    }

    if (points.length < 3 || Math.abs(polygonArea(points)) < 2) continue;
    simplifiedNodes += points.length;
    horizontalSnaps += snaps.horizontalSnaps;
    verticalSnaps += snaps.verticalSnaps;
    processed.push({
      points,
      area: polygonArea(points),
      rectilinearRatio: ratio,
      type: classification.type,
      profile: classification.profile,
      density: classification.density
    });
  }

  processed.sort((left, right) => Math.abs(right.area) - Math.abs(left.area));
  const pathData = processed.map((item) => item.type === 'curve'
    ? catmullRomPath(item.points, 0.78)
    : polygonPath(item.points)).filter(Boolean).join('');
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
      polygonLoops: processed.filter((item) => item.type === 'polygon').length,
      curvedLoops: processed.filter((item) => item.type === 'curve').length,
      rectilinearLoops: processed.filter((item) => item.rectilinearRatio >= 0.58).length,
      hybridMode: true
    }
  };
}

module.exports = {
  ...base,
  catmullRomPath,
  classifyContour,
  polygonPath,
  reconstructBinarySvg,
  turningProfile
};