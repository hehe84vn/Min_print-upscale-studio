'use strict';

const fs = require('node:fs/promises');
const engine = require('./vectorLogoEngine');
const { buildAutoTraceColorCandidate } = require('./autotraceSplineCandidateService');
const { inspectColorVectorQuality, rankColorCandidates } = require('./colorVectorQualityService');
const { rankCandidatesByConsensus } = require('./vectorConsensusRankingService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutSvg(candidate) {
  const { svg, ...metadata } = candidate;
  return metadata;
}

function unavailableColorComponentValidation() {
  return {
    available: false,
    reason: 'color-component-analysis-unavailable',
    sourceComponentCount: null,
    renderedComponentCount: null,
    worstComponentIoU: null,
    p10ComponentIoU: null,
    medianComponentIoU: null,
    weightedComponentIoU: null,
    unmatchedSourceComponents: null,
    worstComponents: []
  };
}

function sanitizeColorCandidate(candidate) {
  if (!candidate) return candidate;
  const metrics = { ...(candidate.metrics || {}) };
  metrics.orientationAgreement = null;
  metrics.axisAgreement = null;
  metrics.cornerPreservation = null;
  metrics.componentScore = null;
  metrics.componentValidation = unavailableColorComponentValidation();
  return { ...candidate, metrics };
}

function markVTracerCandidate(candidate) {
  return sanitizeColorCandidate({
    ...candidate,
    engine: 'vtracer',
    trace: {
      ...(candidate.trace || {}),
      engine: candidate.trace?.engine || 'vtracer',
      algorithm: candidate.trace?.algorithm || 'vtracer'
    }
  });
}

function selectedCandidateFromReport(report) {
  return report?.candidates?.find((candidate) => candidate.id === report.selectedCandidate) || null;
}

function routedVTracerStrategy(strategy = 'smart') {
  return strategy === 'smart' ? 'detail' : strategy;
}

function routedPaletteColors(strategy = 'smart', requested = null) {
  const value = Number(requested);
  if ([8, 12, 16, 24, 32, 48, 64].includes(value)) return value;
  if (strategy === 'detail') return 16;
  if (strategy === 'compact') return 8;
  return 12;
}

function colorWarnings(candidate) {
  const warnings = [];
  if (candidate.metrics?.detailLossRisk) warnings.push(`Candidate mất quá nhiều chi tiết nguồn: edge recall ${candidate.metrics.edgeRecall}%.`);
  else if (candidate.metrics?.edgeRecall < 75) warnings.push('Edge recall thấp; nên kiểm tra chi tiết nhỏ trong Illustrator.');
  if (candidate.metrics?.nodeEstimate > 5000) warnings.push('SVG vẫn có nhiều node; thử chế độ Ít node hoặc giảm số màu.');
  if (candidate.metrics?.stairStepRisk) warnings.push('Candidate có dấu hiệu biên bậc thang và thiếu Bézier; không nên dùng cho logo nhiều đường cong.');
  if (candidate.metrics?.paletteOverflow) warnings.push(`Candidate phát sinh ${candidate.metrics.colorCount} màu, vượt ngân sách ${candidate.metrics.requestedColors} màu phẳng.`);
  if (candidate.metrics?.paletteValidationAvailable === false) warnings.push('Không đọc được palette của SVG; candidate không đủ điều kiện tự động chọn.');
  if ((candidate.metrics?.curveFitScore ?? 100) < 55) warnings.push('Curve-fit thấp; cần kiểm tra vòng cung và chữ cong ở mức zoom lớn.');
  if (candidate.consensus?.available && candidate.consensus.agreementScore < 35) warnings.push('Candidate lệch mạnh khỏi đồng thuận giữa các engine; cần kiểm tra preview trước khi dùng.');
  return warnings;
}

async function writeReport(result) {
  await fs.writeFile(result.reportPath, JSON.stringify(result.vectorReport, null, 2), 'utf8');
  return result;
}

function applyStandaloneColorQuality(candidate, strategy) {
  const sanitized = sanitizeColorCandidate(candidate);
  const requestedColors = sanitized.preprocessing?.paletteColors || 16;
  const quality = inspectColorVectorQuality(sanitized.svg, {
    requestedColors,
    colorCount: sanitized.metrics?.colorCount,
    edgeRecall: sanitized.metrics?.edgeRecall,
    edgeAgreement: sanitized.metrics?.edgeAgreement
  });
  sanitized.metrics = { ...(sanitized.metrics || {}), ...quality };
  sanitized.rejected = quality.rejected;
  sanitized.rejectedReason = quality.rejectReasons.join(' ') || null;
  sanitized.qualityStrategy = strategy;
  return sanitized;
}

function colorQualityGate(report, candidate, warnings) {
  return {
    ...(report.qualityGate || {}),
    status: candidate.rejected ? 'reject' : warnings.length ? 'review' : 'pass',
    worstComponentIoU: null,
    p10ComponentIoU: null,
    cornerPreservation: null,
    componentValidationAvailable: false,
    selectedEngine: candidate.engine,
    fidelity: candidate.metrics?.fidelity,
    edgeAgreement: candidate.metrics?.edgeAgreement,
    edgeRecall: candidate.metrics?.edgeRecall,
    detailLossRisk: candidate.metrics?.detailLossRisk,
    nodeEstimate: candidate.metrics?.nodeEstimate,
    curveFitScore: candidate.metrics?.curveFitScore,
    curveCommandCount: candidate.metrics?.curveCommandCount,
    lineCommandCount: candidate.metrics?.lineCommandCount,
    paletteScore: candidate.metrics?.paletteScore,
    paletteValidationAvailable: candidate.metrics?.paletteValidationAvailable,
    paletteOverflow: candidate.metrics?.paletteOverflow,
    stairStepRisk: candidate.metrics?.stairStepRisk,
    consensusAgreement: candidate.consensus?.agreementScore ?? null,
    consensusScore: candidate.consensusScore ?? null
  };
}

function replaceCandidateMetadata(report, candidate) {
  const metadata = withoutSvg(candidate);
  report.candidates = (report.candidates || []).map((item) => item.id === candidate.id
    ? { ...item, ...metadata }
    : item);
}

async function runColorMultiEngine({ inputPath, outputPath, options = {}, onProgress }) {
  const requestedStrategy = options.strategy || 'smart';
  const vtracerStrategy = routedVTracerStrategy(requestedStrategy);
  const paletteColors = routedPaletteColors(requestedStrategy, options.paletteColors);

  onProgress?.(12, `VTracer: candidate màu ${vtracerStrategy}, palette ${paletteColors}`);
  const vtracerResult = await engine.vectorizeLogo({
    inputPath,
    outputPath,
    options: {
      ...options,
      strategy: vtracerStrategy,
      paletteColors,
      colorMode: 'color',
      backgroundCleanup: false
    },
    onProgress: (percent, message) => onProgress?.(12 + Math.round(percent * 0.38), message)
  });

  const report = vtracerResult.vectorReport;
  report.strategy = requestedStrategy;
  report.candidates = (report.candidates || []).map(markVTracerCandidate);
  const selectedMetadata = selectedCandidateFromReport(report);
  if (!selectedMetadata) throw new Error('VTracer không trả về candidate màu đã chọn.');
  const vtracerSvg = await fs.readFile(outputPath, 'utf8');
  const vtracerCandidate = applyStandaloneColorQuality({
    ...clone(selectedMetadata),
    engine: 'vtracer',
    svg: vtracerSvg
  }, requestedStrategy);

  if (options.vectorEngine === 'vtracer' || options.autoTrace === false) {
    report.schemaVersion = Math.max(Number(report.schemaVersion || 0), 10);
    report.engineRouter = {
      selectedEngine: 'vtracer',
      actualEngine: 'vtracer',
      attemptedEngines: ['vtracer'],
      sourceType: 'color',
      requestedStrategy,
      vtracerStrategy,
      paletteColors,
      routingPolicy: 'forced-vtracer-curve-safe'
    };
    report.selectedScore = vtracerCandidate.score;
    replaceCandidateMetadata(report, vtracerCandidate);
    report.warnings = [...colorWarnings(vtracerCandidate), ...(report.warnings || [])];
    report.qualityGate = colorQualityGate(report, vtracerCandidate, report.warnings);
    return writeReport(vtracerResult);
  }

  let autotraceCandidate = null;
  let autotraceError = null;
  try {
    autotraceCandidate = await buildAutoTraceColorCandidate({
      inputPath,
      options: { ...options, strategy: requestedStrategy, paletteColors },
      onProgress
    });
  } catch (error) {
    autotraceError = error;
  }

  if (!autotraceCandidate) {
    const reason = autotraceError?.message || 'AutoTrace candidate không khả dụng.';
    report.schemaVersion = Math.max(Number(report.schemaVersion || 0), 10);
    report.engineRouter = {
      selectedEngine: 'vtracer',
      actualEngine: 'vtracer',
      attemptedEngines: ['vtracer', 'autotrace'],
      sourceType: 'color',
      requestedStrategy,
      vtracerStrategy,
      paletteColors,
      fallbackEngine: 'vtracer',
      fallbackReason: reason,
      runtime: autotraceError?.runtime || null,
      routingPolicy: 'autotrace-optional-curve-safe-vtracer'
    };
    replaceCandidateMetadata(report, vtracerCandidate);
    report.warnings = [
      `AutoTrace không khả dụng; giữ VTracer ${vtracerStrategy}: ${reason}`,
      ...colorWarnings(vtracerCandidate),
      ...(report.warnings || [])
    ];
    report.candidateErrors = [
      ...(report.candidateErrors || []),
      { id: 'autotrace', code: autotraceError?.code || 'AUTOTRACE_UNAVAILABLE', error: reason }
    ];
    report.qualityGate = colorQualityGate(report, vtracerCandidate, report.warnings);
    return writeReport(vtracerResult);
  }

  onProgress?.(82, 'Đang xếp hạng fidelity, cạnh, Bézier, palette và node');
  autotraceCandidate = sanitizeColorCandidate(autotraceCandidate);
  const qualityRanked = rankColorCandidates([
    vtracerCandidate,
    autotraceCandidate
  ], requestedStrategy, engine.scoreCandidates);
  onProgress?.(88, 'Đang đo đồng thuận hình ảnh giữa các engine');
  const ranked = await rankCandidatesByConsensus(qualityRanked, {
    renderSize: Number(options.consensusRenderSize) || 640
  });
  const selected = ranked.find((candidate) => !candidate.rejected) || ranked[0];
  await fs.writeFile(outputPath, selected.svg, 'utf8');

  const comparisonMetadata = ranked.map(withoutSvg);
  const vtracerCompared = comparisonMetadata.find((candidate) => candidate.engine === 'vtracer');
  const autotraceCompared = comparisonMetadata.find((candidate) => candidate.engine === 'autotrace');
  if (vtracerCompared) replaceCandidateMetadata(report, { ...vtracerCompared, svg: '' });
  if (autotraceCompared) report.candidates.push(autotraceCompared);
  report.schemaVersion = 10;
  report.selectedCandidate = selected.id;
  report.selectedScore = selected.consensusScore ?? selected.score;
  report.engineRouter = {
    selectedEngine: selected.engine,
    actualEngine: selected.trace?.engine || selected.engine,
    attemptedEngines: ['vtracer', 'autotrace'],
    sourceType: 'color',
    requestedStrategy,
    vtracerStrategy,
    paletteColors,
    routingPolicy: 'quality-gated-multi-engine-consensus-ranking',
    consensusAgreement: selected.consensus?.agreementScore ?? null,
    runtime: selected.trace?.runtime || null
  };
  report.engineComparison = comparisonMetadata;
  report.consensusRanking = comparisonMetadata.map((candidate) => ({
    id: candidate.id,
    engine: candidate.engine,
    rejected: candidate.rejected,
    baseScore: candidate.score,
    consensusScore: candidate.consensusScore,
    agreementScore: candidate.consensus?.agreementScore,
    peers: candidate.consensus?.peers || []
  }));
  report.warnings = [
    ...colorWarnings(selected),
    ...(report.warnings || []).filter((warning) => !/Edge recall thấp|mất quá nhiều chi tiết|SVG vẫn có nhiều node|Curve-fit|biên bậc thang|phát sinh .* màu|Không đọc được palette|đồng thuận giữa các engine/.test(warning))
  ];
  report.qualityGate = colorQualityGate(report, selected, report.warnings);
  onProgress?.(96, `${selected.label} thắng · consensus ${selected.consensus?.agreementScore ?? '—'} · recall ${selected.metrics?.edgeRecall ?? '—'} · curve ${selected.metrics?.curveFitScore ?? '—'} · ${selected.metrics?.nodeEstimate ?? '—'} node`);
  return writeReport(vtracerResult);
}

module.exports = {
  applyStandaloneColorQuality,
  colorQualityGate,
  colorWarnings,
  markVTracerCandidate,
  routedPaletteColors,
  routedVTracerStrategy,
  runColorMultiEngine,
  sanitizeColorCandidate,
  selectedCandidateFromReport,
  unavailableColorComponentValidation,
  withoutSvg
};
