'use strict';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizePaint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['none', 'currentcolor', 'transparent', 'inherit', 'initial', 'unset'].includes(normalized)) return null;
  return normalized;
}

function svgColors(text) {
  const source = String(text || '');
  const colors = new Set();
  const add = (value) => {
    const normalized = normalizePaint(value);
    if (normalized) colors.add(normalized);
  };

  for (const match of source.matchAll(/(?:fill|stroke|stop-color)\s*=\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of source.matchAll(/\b(?:fill|stroke|stop-color)\s*:\s*([^;}"']+)/gi)) add(match[1]);
  return [...colors];
}

function svgColorCount(text) {
  return svgColors(text).length;
}

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  const suppliedColorCount = finiteMetric(options.colorCount);
  const parsedColors = svgColors(text);
  const colorCount = suppliedColorCount && suppliedColorCount > 0 ? suppliedColorCount : parsedColors.length;
  const requestedColors = Math.max(2, Number(options.requestedColors) || 16);
  const paletteValidationAvailable = colorCount > 0;
  const edgeRecall = finiteMetric(options.edgeRecall);
  const edgeAgreement = finiteMetric(options.edgeAgreement);

  let curveFitScore;
  if (!segmentCount) curveFitScore = 0;
  else if (curveCommandCount > 0) {
    curveFitScore = 64 + Math.min(36, curveRatio * 150) - Math.max(0, axisLineRatio - 0.72) * 28;
  } else if (lineCommandCount <= 160) curveFitScore = 92;
  else if (lineCommandCount <= 400) curveFitScore = 68;
  else if (lineCommandCount <= 800) curveFitScore = 38;
  else curveFitScore = Math.max(0, 22 - (lineCommandCount - 800) / 100);

  let paletteScore = paletteValidationAvailable ? 100 : 0;
  if (paletteValidationAvailable && colorCount > requestedColors + 2) paletteScore = 82;
  if (paletteValidationAvailable && colorCount > requestedColors * 1.5) paletteScore = 55;
  if (paletteValidationAvailable && colorCount > requestedColors * 2) paletteScore = 25;
  if (paletteValidationAvailable && colorCount > Math.max(requestedColors * 3, requestedColors + 24)) paletteScore = 0;

  const stairStepRisk = curveCommandCount === 0
    && lineCommandCount >= 500
    && (axisLineRatio >= 0.35 || averageSegmentsPerPath >= 10);
  const severeLineDensity = curveCommandCount === 0 && lineCommandCount >= 1400;
  const paletteOverflow = paletteValidationAvailable
    && colorCount > Math.max(requestedColors * 3, requestedColors + 24);
  const detailLossRisk = edgeRecall !== null && (
    edgeRecall < 55
    || (edgeRecall < 65 && edgeAgreement !== null && edgeAgreement < 60)
  );
  const rejectReasons = [];
  if (stairStepRisk || severeLineDensity) rejectReasons.push('Biên cong bị biểu diễn bằng quá nhiều đoạn line bậc thang, không có Bézier.');
  if (paletteOverflow) rejectReasons.push(`SVG phát sinh ${colorCount} màu, vượt xa ngân sách ${requestedColors} màu phẳng.`);
  if (!paletteValidationAvailable && pathCount > 0) rejectReasons.push('Không đọc được palette màu từ SVG nên không thể xác nhận độ trung thành màu.');
  if (detailLossRisk) rejectReasons.push(`Edge recall chỉ đạt ${edgeRecall}%; candidate làm mất quá nhiều đường biên và chi tiết nguồn.`);

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
    parsedColors,
    requestedColors,
    paletteValidationAvailable,
    edgeRecall,
    edgeAgreement,
    detailLossRisk,
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
      colorCount: candidate.metrics?.colorCount,
      edgeRecall: candidate.metrics?.edgeRecall,
      edgeAgreement: candidate.metrics?.edgeAgreement
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
  svgColorCount,
  svgColors
};
