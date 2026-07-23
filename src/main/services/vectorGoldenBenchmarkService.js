'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { inspectColorVectorQuality } = require('./colorVectorQualityService');
const { validateSvgCleanup } = require('./vectorVisualValidationService');

const DEFAULT_THRESHOLDS = {
  minimumShapeIoU: 96,
  maximumForegroundChangedRatio: 4,
  maximumMeanColorDelta: 10,
  maximumNodeRatio: 1.35,
  maximumDurationMs: 30000
};

function countNodes(svg) {
  const commands = String(svg).match(/[MLHVCSQTAZmlhvcsqtaz]/g) || [];
  return commands.length;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; }
}

async function inspectSvg(svgPath, goldenPath, thresholds = {}) {
  const started = Date.now();
  const [svg, goldenSvg] = await Promise.all([
    fs.readFile(svgPath, 'utf8'),
    fs.readFile(goldenPath, 'utf8')
  ]);
  const visual = await validateSvgCleanup(goldenSvg, svg, {
    minimumShapeIoU: thresholds.minimumShapeIoU ?? DEFAULT_THRESHOLDS.minimumShapeIoU,
    maximumForegroundChangedRatio: thresholds.maximumForegroundChangedRatio ?? DEFAULT_THRESHOLDS.maximumForegroundChangedRatio,
    maximumMeanColorDelta: thresholds.maximumMeanColorDelta ?? DEFAULT_THRESHOLDS.maximumMeanColorDelta
  });
  const quality = inspectColorVectorQuality(svg, {});
  const nodes = countNodes(svg);
  const goldenNodes = countNodes(goldenSvg);
  const durationMs = Date.now() - started;
  const nodeRatio = goldenNodes ? nodes / goldenNodes : 1;
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const failures = [];
  if (!visual.passed) failures.push(...(visual.reasons || ['visual-validation-failed']));
  if (nodeRatio > limits.maximumNodeRatio) failures.push(`node-ratio ${nodeRatio.toFixed(3)} > ${limits.maximumNodeRatio}`);
  if (durationMs > limits.maximumDurationMs) failures.push(`duration ${durationMs}ms > ${limits.maximumDurationMs}ms`);
  return {
    durationMs,
    nodes,
    goldenNodes,
    nodeRatio: Number(nodeRatio.toFixed(4)),
    fidelity: quality.fidelity ?? null,
    edgeRecall: quality.edgeRecall ?? null,
    curveFitScore: quality.curveFitScore ?? null,
    paletteScore: quality.paletteScore ?? null,
    shapeIoU: visual.metrics?.shapeIoU ?? null,
    foregroundChangedRatio: visual.metrics?.foregroundChangedRatio ?? null,
    meanColorDelta: visual.metrics?.meanColorDelta ?? null,
    pass: failures.length === 0,
    failures
  };
}

function compareBaseline(result, baseline) {
  if (!baseline) return { available: false, regressions: [] };
  const regressions = [];
  if (result.shapeIoU != null && baseline.shapeIoU != null && result.shapeIoU < baseline.shapeIoU - 0.5) regressions.push('shapeIoU');
  if (result.foregroundChangedRatio != null && baseline.foregroundChangedRatio != null && result.foregroundChangedRatio > baseline.foregroundChangedRatio + 0.5) regressions.push('foregroundChangedRatio');
  if (result.meanColorDelta != null && baseline.meanColorDelta != null && result.meanColorDelta > baseline.meanColorDelta + 1) regressions.push('meanColorDelta');
  if (result.nodeRatio > (baseline.nodeRatio || 1) * 1.15) regressions.push('nodeRatio');
  return { available: true, regressions };
}

function htmlReport(summary) {
  const rows = summary.results.map((item) => `<tr><td>${item.id}</td><td>${item.group || ''}</td><td>${item.metrics.shapeIoU ?? '—'}</td><td>${item.metrics.nodeRatio}</td><td>${item.metrics.meanColorDelta ?? '—'}</td><td class="${item.pass ? 'pass' : 'fail'}">${item.pass ? 'PASS' : 'FAIL'}</td><td>${item.failures.join('<br>')}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Vector Golden Benchmark</title><style>body{font-family:system-ui;margin:32px;color:#18202a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3da;padding:8px;text-align:left}.pass{color:#08752b;font-weight:700}.fail{color:#b42318;font-weight:700}</style><h1>Vector Golden Benchmark</h1><p>${summary.passed}/${summary.total} passed · ${summary.generatedAt}</p><table><thead><tr><th>ID</th><th>Group</th><th>Shape IoU</th><th>Node ratio</th><th>Color Δ</th><th>Status</th><th>Failures</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function runGoldenBenchmark({ rootDirectory, outputDirectory, version = 'dev' }) {
  const manifestPath = path.join(rootDirectory, 'manifest.json');
  const manifest = await readJson(manifestPath);
  if (!manifest?.samples?.length) throw new Error('Golden benchmark manifest không có sample.');
  const globalThresholds = await readJson(path.join(rootDirectory, 'thresholds.json'), DEFAULT_THRESHOLDS);
  const baseline = await readJson(path.join(rootDirectory, 'baseline.json'), {});
  await fs.mkdir(outputDirectory, { recursive: true });
  const results = [];
  for (const sample of manifest.samples) {
    const sampleRoot = path.join(rootDirectory, sample.directory);
    const candidatePath = path.join(sampleRoot, sample.candidate || 'candidate.svg');
    const goldenPath = path.join(sampleRoot, sample.golden || 'golden.svg');
    const metrics = await inspectSvg(candidatePath, goldenPath, { ...globalThresholds, ...(sample.thresholds || {}) });
    const baselineComparison = compareBaseline(metrics, baseline[sample.id]);
    const failures = [...metrics.failures, ...baselineComparison.regressions.map((name) => `baseline-regression:${name}`)];
    results.push({ id: sample.id, group: sample.group || null, directory: sample.directory, metrics, baselineComparison, failures, pass: failures.length === 0 });
  }
  const summary = {
    schemaVersion: 1,
    version,
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.pass).length,
    failed: results.filter((item) => !item.pass).length,
    pass: results.every((item) => item.pass),
    results
  };
  await fs.writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
  const headers = ['id','group','pass','shapeIoU','foregroundChangedRatio','meanColorDelta','nodeRatio','durationMs','failures'];
  const csvRows = results.map((item) => [item.id,item.group,item.pass,item.metrics.shapeIoU,item.metrics.foregroundChangedRatio,item.metrics.meanColorDelta,item.metrics.nodeRatio,item.metrics.durationMs,item.failures.join('|')].map(csvEscape).join(','));
  await fs.writeFile(path.join(outputDirectory, 'summary.csv'), `${headers.join(',')}\n${csvRows.join('\n')}\n`);
  await fs.writeFile(path.join(outputDirectory, 'report.html'), htmlReport(summary));
  return summary;
}

module.exports = { DEFAULT_THRESHOLDS, compareBaseline, countNodes, inspectSvg, runGoldenBenchmark };
