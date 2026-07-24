'use strict';

const { serializePathData } = require('./vectorGeometryLock');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentPoints(segment) {
  const points = [segment.start, segment.end];
  if (segment.c1) points.push(segment.c1);
  if (segment.c2) points.push(segment.c2);
  if (segment.c) points.push(segment.c);
  return points.filter(Boolean);
}

function boundsForSegments(segments) {
  const points = segments.flatMap(segmentPoints);
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function tangentAtStart(segment) {
  if (segment.type === 'C') return { x: segment.c1.x - segment.start.x, y: segment.c1.y - segment.start.y };
  if (segment.type === 'Q') return { x: segment.c.x - segment.start.x, y: segment.c.y - segment.start.y };
  return { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y };
}

function tangentAtEnd(segment) {
  if (segment.type === 'C') return { x: segment.end.x - segment.c2.x, y: segment.end.y - segment.c2.y };
  if (segment.type === 'Q') return { x: segment.end.x - segment.c.x, y: segment.end.y - segment.c.y };
  return { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y };
}

function vectorAngleDegrees(left, right) {
  const leftLength = Math.hypot(left.x, left.y);
  const rightLength = Math.hypot(right.x, right.y);
  if (leftLength < 1e-9 || rightLength < 1e-9) return 0;
  const cosine = clamp((left.x * right.x + left.y * right.y) / (leftLength * rightLength), -1, 1);
  return Math.acos(cosine) * 180 / Math.PI;
}

function countSharpCorners(segments, thresholdDegrees = 42) {
  const geometry = segments.filter((segment) => !['M', 'Z'].includes(segment.type));
  let sharpCorners = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const incoming = tangentAtEnd(geometry[index - 1]);
    const outgoing = tangentAtStart(geometry[index]);
    if (vectorAngleDegrees(incoming, outgoing) >= thresholdDegrees) sharpCorners += 1;
  }
  return sharpCorners;
}

function analyzeAdaptivePath(segments, canvasSize = { width: 1000, height: 1000 }) {
  const geometry = segments.filter((segment) => !['M', 'Z'].includes(segment.type));
  const bounds = boundsForSegments(segments);
  const maximumCanvas = Math.max(canvasSize.width || 1, canvasSize.height || 1, 1);
  const extentRatio = Math.max(bounds.width, bounds.height) / maximumCanvas;
  const lineCount = geometry.filter((segment) => segment.type === 'L').length;
  const curveCount = geometry.filter((segment) => ['C', 'Q', 'A'].includes(segment.type)).length;
  const closed = segments.some((segment) => segment.type === 'Z');
  const sharpCorners = countSharpCorners(segments);
  const cornerRatio = sharpCorners / Math.max(1, geometry.length - 1);
  const lineRatio = lineCount / Math.max(1, geometry.length);
  const aspect = bounds.height > 1e-9 ? bounds.width / bounds.height : 1;

  const textLike = extentRatio <= 0.34
    && geometry.length >= 4
    && (cornerRatio >= 0.18 || lineRatio >= 0.5)
    && (aspect >= 0.18 && aspect <= 8);
  const sharp = cornerRatio >= 0.24 || lineRatio >= 0.72;
  const organic = !sharp && curveCount >= lineCount;

  return {
    bounds,
    geometryCount: geometry.length,
    lineCount,
    curveCount,
    lineRatio,
    sharpCorners,
    cornerRatio,
    closed,
    textLike,
    sharp,
    organic,
    className: textLike ? 'text' : sharp ? 'sharp' : organic ? 'organic' : 'mixed'
  };
}

function adaptiveFittingOptions(analysis, base = {}) {
  const options = { ...base };
  if (analysis.textLike) {
    options.errorTolerance = Number(base.errorTolerance) * 0.55;
    options.smoothAngleDegrees = Math.min(Number(base.smoothAngleDegrees), 5.5);
    options.mergeAngleDegrees = Math.min(Number(base.mergeAngleDegrees), 1.8);
    options.skipBezierMerge = analysis.cornerRatio >= 0.28;
  } else if (analysis.sharp) {
    options.errorTolerance = Number(base.errorTolerance) * 0.7;
    options.smoothAngleDegrees = Math.min(Number(base.smoothAngleDegrees), 4);
    options.mergeAngleDegrees = Math.min(Number(base.mergeAngleDegrees), 1.5);
    options.skipBezierMerge = true;
  } else if (analysis.organic) {
    options.errorTolerance = Number(base.errorTolerance) * 1.15;
    options.smoothAngleDegrees = Math.max(Number(base.smoothAngleDegrees), 13);
    options.mergeAngleDegrees = Math.max(Number(base.mergeAngleDegrees), 5.5);
    options.skipBezierMerge = false;
  }
  return options;
}

function ellipseResidual(segments, bounds) {
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  if (rx < 1e-6 || ry < 1e-6) return Infinity;
  const points = segments.flatMap(segmentPoints);
  if (points.length < 8) return Infinity;
  let total = 0;
  for (const point of points) {
    const normalized = Math.sqrt(((point.x - center.x) / rx) ** 2 + ((point.y - center.y) / ry) ** 2);
    total += Math.abs(normalized - 1);
  }
  return total / points.length;
}

function createEllipseSegments(bounds) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  const k = 0.5522847498307936;
  return [
    { type: 'M', start: { x: cx + rx, y: cy }, end: { x: cx + rx, y: cy } },
    { type: 'C', start: { x: cx + rx, y: cy }, c1: { x: cx + rx, y: cy + k * ry }, c2: { x: cx + k * rx, y: cy + ry }, end: { x: cx, y: cy + ry } },
    { type: 'C', start: { x: cx, y: cy + ry }, c1: { x: cx - k * rx, y: cy + ry }, c2: { x: cx - rx, y: cy + k * ry }, end: { x: cx - rx, y: cy } },
    { type: 'C', start: { x: cx - rx, y: cy }, c1: { x: cx - rx, y: cy - k * ry }, c2: { x: cx - k * rx, y: cy - ry }, end: { x: cx, y: cy - ry } },
    { type: 'C', start: { x: cx, y: cy - ry }, c1: { x: cx + k * rx, y: cy - ry }, c2: { x: cx + rx, y: cy - k * ry }, end: { x: cx + rx, y: cy } },
    { type: 'Z', start: { x: cx + rx, y: cy }, end: { x: cx + rx, y: cy } }
  ];
}

function fitEllipseIfEligible(segments, analysis, options = {}) {
  const minimumSegments = Number(options.minimumEllipseSegments ?? 7);
  const maximumResidual = Number(options.maximumEllipseResidual ?? 0.045);
  const aspect = analysis.bounds.height > 1e-9 ? analysis.bounds.width / analysis.bounds.height : 1;
  const eligible = analysis.closed
    && analysis.geometryCount >= minimumSegments
    && !analysis.textLike
    && !analysis.sharp
    && aspect >= 0.18
    && aspect <= 5.5;
  if (!eligible) return { segments, fitted: false, residual: null };
  const residual = ellipseResidual(segments, analysis.bounds);
  if (residual > maximumResidual) return { segments, fitted: false, residual: Number(residual.toFixed(5)) };
  return {
    segments: createEllipseSegments(analysis.bounds),
    fitted: true,
    residual: Number(residual.toFixed(5)),
    serialized: serializePathData(createEllipseSegments(analysis.bounds), 3)
  };
}

module.exports = {
  adaptiveFittingOptions,
  analyzeAdaptivePath,
  boundsForSegments,
  countSharpCorners,
  createEllipseSegments,
  ellipseResidual,
  fitEllipseIfEligible
};
