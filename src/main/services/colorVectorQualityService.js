'use strict';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function svgColorCount(text) {
  const colors = new Set();
  for (const match of String(text || '').matchAll(/(?:fill|stroke)=['"]([^'"]+)['"]/gi)) {
    const value = match[1].trim().toLowerCase();
    if (!['none', 'currentcolor'].includes(value)) colors.add(value);
  }
  return colors.size;
}

function inspectColorVectorQuality(svg, options = {}) {
  const text = String(svg || '');
  const pathData = [...text.matchAll(/\sd=['"]([^'"]+)['"]/gi)].map((match) => match[1]).join(' ');
  const pathCount = (text.match(/<path\b/gi) || []).length;
  const curveCommandCount = (pathData.match(/[CcSsQqTtAa](?=[\s,\-+.\d])/g) || []).length;
  const lineCommandCount = (pathData.match(/[LlHhVv](?=[\s,\-+.\d])/g) || []).length;
  const axisLineCommandCount = (pathData.match(/[HhVv](?=[\s,\-+.\d])/g) || []).length;
  const segmentCount = curveCommandCount + lineCommandCount;
  const curveRatio = segmentCount ? curveCommandCount / segmentCount : 0;
  const axisLineRatio = lineCommandCount ? axisLineCommandCount / lineCommandCount : 0;
  const averageSegmentsPerPath = segmentCount / Math.max(1, pathCount);
  const colorCount = Number(options.colorCount) || svgColorCount(text);
  const requestedColors = Math.max(2, Number(options.requestedColors) || 16);

  let curveFitScore;
  if (!segmentCount) curveFitScore = 0;
  else if (curveCommandCount > 0) {
    curveFitScore = 64 + Math.min(36, curveRatio * 150) - Math.max(0, axisLineRatio - 0.72) * 28;
  } else if (lineCommandCount <= 160) curveFitScore = 92;
  else if (lineCommandCount <= 400) curveFitScore = 68;
  else if (lineCommandCount <= 800) curveFitScore = 38;
  else curveFitScore = Math.max(0, 22 - (lineCommandCount - 800) / 100);

  let paletteScore = 100;
  if (colorCount > requestedColors + 2) paletteScore = 82;
  if (colorCount > requestedColors * 1.5) paletteScore = 55;
  if (colorCount > requestedColors * 2) paletteScore = 25;
  if (colorCount > Math.max(requestedColors * 3, requestedColors + 24)) paletteScore = 0;

  const stairStepRisk = curveCommandCount === 0
    && lineCommandCount >= 500
    && (axisLineRatio >= 0.35 || averageSegmentsPerPath >= 10);
  const severeLineDensity = curveCommandCount === 0 && lineCommandCount >= 1400;
  const paletteOverflow = colorCount > Math.max(requestedColors * 3, requestedColors + 24);
  const rejectReasons = [];
  if (stairStepRisk || severeLineDensity) rejectReasons.push('Biên cong bị biểu diễn bằng quá nhiều đoạn line bậc thang, không có Bézier.');
  if (paletteOverflow) rejectReasons.push(`SVG phát sinh ${colorCount} màu, vượt xa ngân sách ${requestedColors} màu phẳng.`);

  return {
    curveCommandCount,
    lineCommandCount,
    axisLineCommandCount,
    segmentCount,
    curveRatio: Number((curveRatio * 100).toFixed(2)),
    axisLineRatio: Number((axisLineRatio * 100).toFixed(2)),
    averageSegmentsPerPath: Number(averageSegmentsPerPath.toFixed(2)),
    curveFitScore: Number(clamp(curveFitScore, 0, 100).toFixed(2)),
    paletteScore: Number(clamp(paletteScore, 0, 100).toFixed(2)),
    colorCount,
    requestedColors,
    stairStepRisk,
    severeLineDensity,
    paletteOverflow,
    rejected: rejectReasons.length > 0,
    rejectReasons
  };
}

function qualityWeights(strategy) {
  if (strategy === 'detail') return { base: 0.72, curve: 0.20, palette: 0.08 };
  if (strategy === 'compact') return { base: 0.70, curve: 0.15, palette: 0.15 };
  return { base: 0.70, curve: 0.20, palette: 0.10 };
}

function rankColorCandidates(candidates, strategy, baseRanker) {
  const baseRanked = baseRanker(candidates, strategy, false);
  const weights = qualityWeights(strategy);
  for (const candidate of baseRanked) {
    const requestedColors = candidate.preprocessing?.paletteColors
      || candidate.trace?.params?.colorCount
      || 16;
    const quality = inspectColorVectorQuality(candidate.svg, {
      requestedColors,
      colorCount: candidate.metrics?.colorCount
    });
    candidate.metrics = {
      ...(candidate.metrics || {}),
      ...quality
    };
    candidate.baseScore = candidate.score;
    candidate.score = Number((
      candidate.baseScore * weights.base
      + quality.curveFitScore * weights.curve
      + quality.paletteScore * weights.palette
    ).toFixed(2));
    if (quality.rejected) {
      candidate.rejected = true;
      candidate.rejectedReason = quality.rejectReasons.join(' ');
    }
  }
  return baseRanked.sort((left, right) => {
    if (left.rejected !== right.rejected) return left.rejected ? 1 : -1;
    return right.score - left.score;
  });
}

module.exports = {
  inspectColorVectorQuality,
  qualityWeights,
  rankColorCandidates,
  svgColorCount
};
