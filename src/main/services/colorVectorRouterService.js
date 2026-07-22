'use strict';

const fs = require('node:fs/promises');
const engine = require('./vectorLogoEngine');
const { buildAutoTraceColorCandidate } = require('./autotraceVectorEngine');

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

function colorWarnings(candidate) {
  const warnings = [];
  if (candidate.metrics?.edgeRecall < 75) warnings.push('Edge recall thấp; nên kiểm tra chi tiết nhỏ trong Illustrator.');
  if (candidate.metrics?.nodeEstimate > 5000) warnings.push('SVG vẫn có nhiều node; thử chế độ Ít node hoặc giảm số màu.');
  return warnings;
}

async function writeReport(result) {
  await fs.writeFile(result.reportPath, JSON.stringify(result.vectorReport, null, 2), 'utf8');
  return result;
}

async function runColorMultiEngine({ inputPath, outputPath, options = {}, onProgress }) {
  onProgress?.(12, 'VTracer: đang tạo candidate màu nền');
  const vtracerResult = await engine.vectorizeLogo({
    inputPath,
    outputPath,
    options: {
      ...options,
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
  const vtracerCandidate = {
    ...clone(selectedMetadata),
    engine: 'vtracer',
    svg: vtracerSvg
  };

  if (options.vectorEngine === 'vtracer' || options.autoTrace === false) {
    report.schemaVersion = Math.max(Number(report.schemaVersion || 0), 7);
    report.engineRouter = {
      selectedEngine: 'vtracer',
      actualEngine: 'vtracer',
      attemptedEngines: ['vtracer'],
      sourceType: 'color',
      routingPolicy: 'forced-vtracer'
    };
    report.selectedScore = vtracerCandidate.score;
    return writeReport(vtracerResult);
  }

  let autotraceCandidate = null;
  let autotraceError = null;
  try {
    autotraceCandidate = await buildAutoTraceColorCandidate({
      inputPath,
      options,
      onProgress
    });
  } catch (error) {
    autotraceError = error;
  }

  if (!autotraceCandidate) {
    const reason = autotraceError?.message || 'AutoTrace candidate không khả dụng.';
    report.schemaVersion = Math.max(Number(report.schemaVersion || 0), 7);
    report.engineRouter = {
      selectedEngine: 'vtracer',
      actualEngine: 'vtracer',
      attemptedEngines: ['vtracer', 'autotrace'],
      sourceType: 'color',
      fallbackEngine: 'vtracer',
      fallbackReason: reason,
      runtime: autotraceError?.runtime || null,
      routingPolicy: 'autotrace-optional'
    };
    report.warnings = [
      `AutoTrace không khả dụng; giữ kết quả VTracer: ${reason}`,
      ...(report.warnings || [])
    ];
    report.candidateErrors = [
      ...(report.candidateErrors || []),
      { id: 'autotrace', code: autotraceError?.code || 'AUTOTRACE_UNAVAILABLE', error: reason }
    ];
    report.qualityGate = {
      ...(report.qualityGate || {}),
      status: 'review'
    };
    return writeReport(vtracerResult);
  }

  onProgress?.(84, 'Đang so sánh VTracer và AutoTrace theo fidelity, cạnh và số node');
  const ranked = engine.scoreCandidates([
    vtracerCandidate,
    autotraceCandidate
  ], options.strategy || 'smart', false);
  const selected = ranked[0];
  await fs.writeFile(outputPath, selected.svg, 'utf8');

  const comparisonMetadata = ranked.map(withoutSvg);
  const vtracerCompared = comparisonMetadata.find((candidate) => candidate.engine === 'vtracer');
  const autotraceCompared = comparisonMetadata.find((candidate) => candidate.engine === 'autotrace');
  report.candidates = report.candidates.map((candidate) => candidate.id === vtracerCompared.id
    ? { ...candidate, ...vtracerCompared }
    : candidate);
  report.candidates.push(autotraceCompared);
  report.schemaVersion = 7;
  report.selectedCandidate = selected.id;
  report.selectedScore = selected.score;
  report.engineRouter = {
    selectedEngine: selected.engine,
    actualEngine: selected.trace?.engine || selected.engine,
    attemptedEngines: ['vtracer', 'autotrace'],
    sourceType: 'color',
    routingPolicy: 'quality-ranked',
    runtime: selected.trace?.runtime || null
  };
  report.engineComparison = comparisonMetadata;
  report.warnings = [
    ...colorWarnings(selected),
    ...(report.warnings || []).filter((warning) => !/Edge recall thấp|SVG vẫn có nhiều node/.test(warning))
  ];
  report.qualityGate = {
    ...(report.qualityGate || {}),
    status: report.warnings.length ? 'review' : 'pass',
    selectedEngine: selected.engine,
    fidelity: selected.metrics?.fidelity,
    edgeAgreement: selected.metrics?.edgeAgreement,
    edgeRecall: selected.metrics?.edgeRecall,
    nodeEstimate: selected.metrics?.nodeEstimate
  };
  onProgress?.(96, `${selected.label} thắng · fidelity ${selected.metrics?.fidelity ?? '—'}% · khoảng ${selected.metrics?.nodeEstimate ?? '—'} node`);
  return writeReport(vtracerResult);
}

module.exports = {
  colorWarnings,
  markVTracerCandidate,
  runColorMultiEngine,
  selectedCandidateFromReport,
  withoutSvg
};
