'use strict';

const {
  cleanPathSegments,
  parsePathData,
  parseSvgSize,
  serializePathData
} = require('./vectorGeometryLock');
const { optimizeBezierSegments } = require('./vectorBezierOptimizer');

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function segmentPoints(segment) {
  const points = [segment.start, segment.end];
  if (segment.c1) points.push(segment.c1);
  if (segment.c2) points.push(segment.c2);
  if (segment.c) points.push(segment.c);
  return points.filter(Boolean);
}

function pathBounds(segments) {
  const points = segments.flatMap(segmentPoints);
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function estimateSegmentLength(segment) {
  if (segment.type === 'M' || segment.type === 'Z') return 0;
  if (segment.type === 'L') return pointDistance(segment.start, segment.end);
  const points = segmentPoints(segment);
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += pointDistance(points[index - 1], points[index]);
  return length;
}

function estimatePathLength(segments) {
  return segments.reduce((sum, segment) => sum + estimateSegmentLength(segment), 0);
}

function removeMicroSegments(segments, threshold) {
  const output = [];
  let removed = 0;
  let current = { x: 0, y: 0 };
  for (const original of segments) {
    const segment = { ...original, start: { ...current } };
    if (segment.type === 'M') {
      output.push(segment);
      current = { ...segment.end };
      continue;
    }
    if (segment.type === 'Z') {
      output.push({ ...segment, start: { ...current } });
      current = { ...segment.end };
      continue;
    }
    if (pointDistance(segment.start, segment.end) <= threshold) {
      removed += 1;
      continue;
    }
    output.push(segment);
    current = { ...segment.end };
  }
  return { segments: output, removed };
}

function closeEligibleSubpaths(segments, tolerance) {
  const output = [];
  let autoClosed = 0;
  let openSubpaths = 0;
  let startIndex = -1;
  let startPoint = null;
  let lastPoint = null;

  const finishSubpath = () => {
    if (startIndex < 0 || !startPoint || !lastPoint) return;
    const last = output.at(-1);
    if (last?.type === 'Z') return;
    const gap = pointDistance(startPoint, lastPoint);
    if (gap > 0 && gap <= tolerance) {
      output.push({ type: 'Z', start: { ...lastPoint }, end: { ...startPoint } });
      autoClosed += 1;
    } else if (gap > tolerance) {
      openSubpaths += 1;
    }
  };

  for (const segment of segments) {
    if (segment.type === 'M') {
      finishSubpath();
      startIndex = output.length;
      startPoint = { ...segment.end };
      lastPoint = { ...segment.end };
      output.push(segment);
      continue;
    }
    output.push(segment);
    if (segment.type === 'Z') {
      lastPoint = { ...segment.end };
      startIndex = -1;
      startPoint = null;
      continue;
    }
    lastPoint = { ...segment.end };
  }
  finishSubpath();
  return { segments: output, autoClosed, openSubpaths };
}

function normalizePathKey(data) {
  return String(data || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim()
    .toLowerCase();
}

function normalizedPaintKey(before, after) {
  return normalizePathKey(`${before || ''} ${after || ''}`
    .replace(/\s*\/\s*$/, '')
    .replace(/\bid=["'][^"']+["']/gi, '')
    .replace(/\bclass=["'][^"']+["']/gi, ''));
}

function cleanupVectorSvg(svg, options = {}) {
  const source = String(svg || '');
  const size = parseSvgSize(source);
  const maximum = Math.max(size.width, size.height, 1);
  const profile = ['precise', 'balanced', 'smooth'].includes(options.profile) ? options.profile : 'balanced';
  const profileFactor = profile === 'precise' ? 0.55 : profile === 'smooth' ? 1.65 : 1;
  const lineTolerance = clamp(options.lineTolerance, 0.01, maximum * 0.02, maximum * 0.00065 * profileFactor);
  const microSegmentThreshold = clamp(options.microSegmentThreshold, 0, maximum * 0.01, maximum * 0.00012 * profileFactor);
  const closeTolerance = clamp(options.closeTolerance, 0, maximum * 0.02, maximum * 0.00045 * profileFactor);
  const minimumPathExtent = clamp(options.minimumPathExtent, 0, maximum * 0.1, maximum * 0.0008 * profileFactor);
  const minimumPathLength = clamp(options.minimumPathLength, 0, maximum, maximum * 0.0018 * profileFactor);
  const bezierErrorTolerance = clamp(options.bezierErrorTolerance, 0.01, maximum * 0.01, maximum * 0.00035 * profileFactor);
  const precision = Math.round(clamp(options.pathPrecision, 1, 6, 3));
  const smoothAngleDegrees = clamp(
    options.smoothAngleDegrees,
    0.1,
    45,
    profile === 'precise' ? 7 : profile === 'smooth' ? 16 : 11
  );
  const mergeAngleDegrees = clamp(
    options.mergeAngleDegrees,
    0.1,
    30,
    profile === 'precise' ? 2.5 : profile === 'smooth' ? 7 : 4.5
  );

  const stats = {
    profile,
    pathCountBefore: 0,
    pathCountAfter: 0,
    duplicatePathsRemoved: 0,
    tinyPathsRemoved: 0,
    microSegmentsRemoved: 0,
    curvesConvertedToLines: 0,
    axisSnaps: 0,
    collinearNodesRemoved: 0,
    tangentJunctionsSmoothed: 0,
    cubicPairsMerged: 0,
    maximumBezierDeviation: 0,
    autoClosedSubpaths: 0,
    openSubpathsRemaining: 0,
    parseErrors: 0,
    lineTolerance,
    microSegmentThreshold,
    closeTolerance,
    minimumPathExtent,
    minimumPathLength,
    bezierErrorTolerance,
    smoothAngleDegrees,
    mergeAngleDegrees
  };

  const seen = new Set();
  const output = source.replace(/<path\b([^>]*?)\bd=(["'])([^"']+)\2([^>]*?)\/?\s*>/gi, (match, before, quote, data, after) => {
    stats.pathCountBefore += 1;
    try {
      let segments = parsePathData(data);
      const micro = removeMicroSegments(segments, microSegmentThreshold);
      segments = micro.segments;
      stats.microSegmentsRemoved += micro.removed;

      const cleaned = cleanPathSegments(segments, {
        lineTolerance,
        axisTolerance: Math.max(0.01, lineTolerance * 0.7),
        axisAngleDegrees: profile === 'smooth' ? 2.2 : profile === 'precise' ? 1.2 : 1.7,
        collinearAngleDegrees: profile === 'smooth' ? 2 : profile === 'precise' ? 0.8 : 1.25
      });
      segments = cleaned.segments;
      stats.curvesConvertedToLines += cleaned.stats.curvesConvertedToLines;
      stats.axisSnaps += cleaned.stats.axisSnaps;
      stats.collinearNodesRemoved += cleaned.stats.collinearNodesRemoved;

      const bezier = optimizeBezierSegments(segments, {
        errorTolerance: bezierErrorTolerance,
        junctionTolerance: Math.max(0.01, lineTolerance * 0.35),
        smoothAngleDegrees,
        mergeAngleDegrees
      });
      segments = bezier.segments;
      stats.tangentJunctionsSmoothed += bezier.stats.tangentJunctionsSmoothed;
      stats.cubicPairsMerged += bezier.stats.cubicPairsMerged;
      stats.maximumBezierDeviation = Math.max(stats.maximumBezierDeviation, bezier.stats.maximumDeviation);

      const closed = closeEligibleSubpaths(segments, closeTolerance);
      segments = closed.segments;
      stats.autoClosedSubpaths += closed.autoClosed;
      stats.openSubpathsRemaining += closed.openSubpaths;

      const bounds = pathBounds(segments);
      const extent = Math.max(bounds.width, bounds.height);
      const length = estimatePathLength(segments);
      const hasGeometry = segments.some((segment) => !['M', 'Z'].includes(segment.type));
      if (!hasGeometry || (extent < minimumPathExtent && length < minimumPathLength)) {
        stats.tinyPathsRemoved += 1;
        return '';
      }

      const serialized = serializePathData(segments, precision);
      const key = `${normalizePathKey(serialized)}|${normalizedPaintKey(before, after)}`;
      if (seen.has(key)) {
        stats.duplicatePathsRemoved += 1;
        return '';
      }
      seen.add(key);
      stats.pathCountAfter += 1;
      const cleanAfter = String(after || '').replace(/\s*\/\s*$/, '');
      return `<path${before}d=${quote}${serialized}${quote}${cleanAfter}/>`;
    } catch {
      stats.parseErrors += 1;
      stats.pathCountAfter += 1;
      return match;
    }
  });

  stats.maximumBezierDeviation = Number(stats.maximumBezierDeviation.toFixed(4));
  return { svg: output, stats };
}

module.exports = {
  cleanupVectorSvg,
  closeEligibleSubpaths,
  estimatePathLength,
  pathBounds,
  removeMicroSegments
};
