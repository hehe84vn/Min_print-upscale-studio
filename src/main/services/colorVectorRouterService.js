'use strict';

const fs = require('node:fs/promises');
const engine = require('./vectorLogoEngine');
const { buildAutoTraceColorCandidate } = require('./autotraceSplineCandidateService');
const { inspectColorVectorQuality, rankColorCandidates } = require('./colorVectorQualityService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutSvg(candidate) {
  const { svg, ...metadata } = candidate;
  return metadata;
}

function markVTracerCandidate(candidate) {
  return {
    ...candidate,
    engine: 'vtracer',
    trace: {
      ...(candidate.trace || {}),
      engine: candidate.trace?.engine || 'vtracer',
      algorithm: candidate.trace?.algorithm || 'vtracer'
    }
  };
}

function selectedCandidateFromReport(report) {
  return report?.candidates?.find((candidate) => candidate.id === report.selectedCandidate) || null;
}

function routedVTracerStrategy(strategy = 'smart') {
  // Smart color artwork must not allow the polygon-only compact preset to win
  // merely because it has fewer nodes. Explicit Compact remains available.
  return strategy === 'smart' ? 'balanced' : strategy;
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
  if (candidate.metrics?.edgeRecall < 75) warnings.push('Edge recall thấp; nên kiểm tra chi tiết nhỏ trong Illustrator.');
  if (candidate.metrics?.nodeEstimate > 5000) warnings.push('SVG vẫn có nhiều node; thử chế độ Ít node hoặc giảm số màu.');
  if (candidate.metrics?.stairStepRisk) warnings.push('Candidate có dấu hiệu biên bậc thang và thiếu Bézier; không nên dùng cho logo nhiều đường cong.');
  if (candidate.metrics?.paletteOverflow) warnings.push(`Candidate phát sinh ${candidate.metrics.colorCount} màu, vượt ngân sách ${candidate.metrics.requestedColors} màu phẳng.`);
  if ((candidate.metrics?.curveFitScore ?? 100) < 55) warnings.push('Curve-fit thấp; cần kiểm tra vòng cung và chữ cong ở mức zoom lớn.');
  return warnings;
}

async function writeReport(result) {
  await fs.writeFile(result.reportPath, JSON.stringify(result.vectorReport, null, 2), 'utf8');
  return result;
}

function applyStandaloneColorQuality(candidate, strategy) {
  const requestedColors = candidate.preprocessing?.paletteColors || 16;
  const quality = inspectColorVectorQuality(candidate.svg, {
    requestedColors,
    colorCount: candidate.metrics?.colorCount
  });
  candidate.metrics = { ...(candidate.metrics || {}), ...quality };
  candidate.rejected = quality.rejected;
  candidate.rejectedReason = quality.rejectReasons.join(' ') || null;
  candidate.qualityStrategy = strategy;
  return candidate;
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
    report.schemaVersion = Math.max(Number(report.schemaVersion || 0), 8);
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
    report.candidates = report.candidates.map((candidate) => candidate.id === vtracerCandidate.id
      ? { ...candidate, ...withoutSvg(vtracerCandidate) }
      : candidate);
    report.warnings = [...colorWarnings(vtracerCandidate), ...(report.warnings || [])];
    report.qualityGate = {
      ...(report.qualityGate || {}),
      status: report.warnings.length || vtracerCandidate.rejected ? 'review' : 'pass',
      selectedEngine: 'vtracer',
      curveFitScore: vtracerCandidate.metrics.curveFitScore,
      paletteScore: vtracerCandidate.metrics.paletteScore
    };
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
    report.schemaVersion = Math.max(Number(report.schemaVersion || 0), 8);
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
    report.candidates = report.candidates.map((candidate) => candidate.id === vtracerCandidate.id
      ? { ...candidate, ...withoutSvg(vtracerCandidate) }
      : candidate);
    report.warnings = [
      `AutoTrace không khả dụng; giữ VTracer ${vtracerStrategy}: ${reason}`,
      ...colorWarnings(vtracerCandidate),
      ...(report.warnings || [])
    ];
    report.candidateErrors = [
      ...(report.candidateErrors || []),
      { id: 'autotrace', code: autotraceError?.code || 'AUTOTRACE_UNAVAILABLE', error: reason }
    ];
    report.qualityGate = {
      ...(report.qualityGate || {}),
      status: 'review',
      selectedEngine: 'vtracer',
      curveFitScore: vtracerCandidate.metrics.curveFitScore,
      paletteScore: vtracerCandidate.metrics.paletteScore,
      stairStepRisk: vtracerCandidate.metrics.stairStepRisk
    };
    return writeReport(vtracerResult);
  }

  onProgress?.(84, 'Đang so VTracer và AutoTrace theo fidelity, cạnh, Bézier, palette và node');
  const ranked = rankColorCandidates([
    vtracerCandidate,
    autotraceCandidate
  ], requestedStrategy, engine.scoreCandidates);
  const selected = ranked[0];
  await fs.writeFile(outputPath, selected.svg, 'utf8');

  const comparisonMetadata = ranked.map(withoutSvg);
  const vtracerCompared = comparisonMetadata.find((candidate) => candidate.engine === 'vtracer');
  const autotraceCompared = comparisonMetadata.find((candidate) => candidate.engine === 'autotrace');
  report.candidates = report.candidates.map((candidate) => candidate.id === vtracerCompared.id
    ? { ...candidate, ...vtracerCompared }
    : candidate);
  report.candidates.push(autotraceCompared);
  report.schemaVersion = 8;
  report.selectedCandidate = selected.id;
  report.selectedScore = selected.score;
  report.engineRouter = {
    selectedEngine: selected.engine,
    actualEngine: selected.trace?.engine || selected.engine,
    attemptedEngines: ['vtracer', 'autotrace'],
    sourceType: 'color',
    requestedStrategy,
    vtracerStrategy,
    paletteColors,
    routingPolicy: 'quality-ranked-with-curve-and-palette-gate',
    runtime: selected.trace?.runtime || null
  };
  report.engineComparison = comparisonMetadata;
  report.warnings = [
    ...colorWarnings(selected),
    ...(report.warnings || []).filter((warning) => !/Edge recall thấp|SVG vẫn có nhiều node|Curve-fit|biên bậc thang|phát sinh .* màu/.test(warning))
  ];
  report.qualityGate = {
    ...(report.qualityGate || {}),
    status: report.warnings.length || selected.rejected ? 'review' : 'pass',
    selectedEngine: selected.engine,
    fidelity: selected.metrics?.fidelity,
    edgeAgreement: selected.metrics?.edgeAgreement,
    edgeRecall: selected.metrics?.edgeRecall,
    nodeEstimate: selected.metrics?.nodeEstimate,
    curveFitScore: selected.metrics?.curveFitScore,
    curveCommandCount: selected.metrics?.curveCommandCount,
    lineCommandCount: selected.metrics?.lineCommandCount,
    paletteScore: selected.metrics?.paletteScore,
    paletteOverflow: selected.metrics?.paletteOverflow,
    stairStepRisk: selected.metrics?.stairStepRisk
  };
  onProgress?.(96, `${selected.label} thắng · curve ${selected.metrics?.curveFitScore ?? '—'} · palette ${selected.metrics?.paletteScore ?? '—'} · ${selected.metrics?.nodeEstimate ?? '—'} node`);
  return writeReport(vtracerResult);
}

module.exports = {
  applyStandaloneColorQuality,
  colorWarnings,
  markVTracerCandidate,
  routedPaletteColors,
  routedVTracerStrategy,
  runColorMultiEngine,
  selectedCandidateFromReport,
  withoutSvg
};
