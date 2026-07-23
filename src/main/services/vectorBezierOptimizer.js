'use strict';

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function unit(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return { x: dx / length, y: dy / length };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y;
}

function angleDegrees(left, right) {
  if (!left || !right) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot(left, right)))) * 180 / Math.PI;
}

function cubicPoint(segment, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * segment.start.x
      + 3 * uu * t * segment.c1.x
      + 3 * u * tt * segment.c2.x
      + tt * t * segment.end.x,
    y: uu * u * segment.start.y
      + 3 * uu * t * segment.c1.y
      + 3 * u * tt * segment.c2.y
      + tt * t * segment.end.y
  };
}

function sampleCubic(segment, steps = 12, includeStart = true) {
  const points = [];
  const first = includeStart ? 0 : 1;
  for (let index = first; index <= steps; index += 1) points.push(cubicPoint(segment, index / steps));
  return points;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-12) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function pointToPolylineDistance(point, polyline) {
  if (!polyline.length) return Infinity;
  if (polyline.length === 1) return distance(point, polyline[0]);
  let best = Infinity;
  for (let index = 1; index < polyline.length; index += 1) {
    best = Math.min(best, pointToSegmentDistance(point, polyline[index - 1], polyline[index]));
  }
  return best;
}

function polylineDeviation(left, right) {
  let maximum = 0;
  for (const point of left) maximum = Math.max(maximum, pointToPolylineDistance(point, right));
  for (const point of right) maximum = Math.max(maximum, pointToPolylineDistance(point, left));
  return maximum;
}

function pairSamples(first, second, steps = 12) {
  return [...sampleCubic(first, steps, true), ...sampleCubic(second, steps, false)];
}

function localDeviation(beforeFirst, beforeSecond, afterFirst, afterSecond) {
  return polylineDeviation(
    pairSamples(beforeFirst, beforeSecond),
    pairSamples(afterFirst, afterSecond)
  );
}

function smoothCubicJunction(previous, next, options) {
  if (previous.type !== 'C' || next.type !== 'C') return null;
  if (distance(previous.end, next.start) > options.junctionTolerance) return null;

  const incoming = unit(previous.c2, previous.end);
  const outgoing = unit(next.start, next.c1);
  const angle = angleDegrees(incoming, outgoing);
  if (angle > options.smoothAngleDegrees) return null;

  const combined = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
  const combinedLength = Math.hypot(combined.x, combined.y);
  if (combinedLength < 1e-9) return null;
  const tangent = { x: combined.x / combinedLength, y: combined.y / combinedLength };
  const junction = { ...previous.end };
  const incomingLength = distance(previous.c2, junction);
  const outgoingLength = distance(junction, next.c1);
  if (incomingLength < 1e-6 || outgoingLength < 1e-6) return null;

  const adjustedPrevious = {
    ...previous,
    c2: {
      x: junction.x - tangent.x * incomingLength,
      y: junction.y - tangent.y * incomingLength
    }
  };
  const adjustedNext = {
    ...next,
    start: { ...junction },
    c1: {
      x: junction.x + tangent.x * outgoingLength,
      y: junction.y + tangent.y * outgoingLength
    }
  };

  const deviation = localDeviation(previous, next, adjustedPrevious, adjustedNext);
  if (deviation > options.errorTolerance) return null;
  return { previous: adjustedPrevious, next: adjustedNext, deviation, originalAngle: angle };
}

function mergeCubicPair(previous, next, options) {
  if (previous.type !== 'C' || next.type !== 'C') return null;
  if (distance(previous.end, next.start) > options.junctionTolerance) return null;
  const incoming = unit(previous.c2, previous.end);
  const outgoing = unit(next.start, next.c1);
  if (angleDegrees(incoming, outgoing) > options.mergeAngleDegrees) return null;

  const merged = {
    type: 'C',
    start: { ...previous.start },
    c1: { ...previous.c1 },
    c2: { ...next.c2 },
    end: { ...next.end }
  };
  const deviation = polylineDeviation(pairSamples(previous, next, 16), sampleCubic(merged, 24, true));
  if (deviation > options.errorTolerance) return null;
  return { segment: merged, deviation };
}

function optimizeBezierSegments(segments, options = {}) {
  const normalized = {
    errorTolerance: Math.max(0, Number(options.errorTolerance) || 0.5),
    junctionTolerance: Math.max(0, Number(options.junctionTolerance) || 0.05),
    smoothAngleDegrees: Math.max(0.1, Math.min(45, Number(options.smoothAngleDegrees) || 12)),
    mergeAngleDegrees: Math.max(0.1, Math.min(30, Number(options.mergeAngleDegrees) || 5))
  };
  const output = segments.map((segment) => ({
    ...segment,
    start: segment.start ? { ...segment.start } : segment.start,
    end: segment.end ? { ...segment.end } : segment.end,
    c1: segment.c1 ? { ...segment.c1 } : segment.c1,
    c2: segment.c2 ? { ...segment.c2 } : segment.c2,
    c: segment.c ? { ...segment.c } : segment.c
  }));
  const stats = {
    tangentJunctionsSmoothed: 0,
    cubicPairsMerged: 0,
    maximumDeviation: 0,
    errorTolerance: normalized.errorTolerance,
    smoothAngleDegrees: normalized.smoothAngleDegrees,
    mergeAngleDegrees: normalized.mergeAngleDegrees
  };

  for (let index = 1; index < output.length; index += 1) {
    const smoothed = smoothCubicJunction(output[index - 1], output[index], normalized);
    if (!smoothed) continue;
    output[index - 1] = smoothed.previous;
    output[index] = smoothed.next;
    stats.tangentJunctionsSmoothed += 1;
    stats.maximumDeviation = Math.max(stats.maximumDeviation, smoothed.deviation);
  }

  let index = 1;
  while (index < output.length) {
    const merged = mergeCubicPair(output[index - 1], output[index], normalized);
    if (!merged) {
      index += 1;
      continue;
    }
    output.splice(index - 1, 2, merged.segment);
    stats.cubicPairsMerged += 1;
    stats.maximumDeviation = Math.max(stats.maximumDeviation, merged.deviation);
    index = Math.max(1, index - 1);
  }

  stats.maximumDeviation = Number(stats.maximumDeviation.toFixed(4));
  return { segments: output, stats };
}

module.exports = {
  angleDegrees,
  cubicPoint,
  mergeCubicPair,
  optimizeBezierSegments,
  polylineDeviation,
  sampleCubic,
  smoothCubicJunction
};
