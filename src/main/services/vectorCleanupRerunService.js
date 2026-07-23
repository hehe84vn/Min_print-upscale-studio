'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { cleanupVectorSvg } = require('./vectorCleanupService');
const { inspectSvgComplexity } = require('./vectorLogoEngine');

const CLEANUP_PROFILES = new Set(['precise', 'balanced', 'smooth']);

function masterPathForOutput(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.master.svg`);
}

function normalizeProfile(value) {
  return CLEANUP_PROFILES.has(value) ? value : 'balanced';
}

async function saveVectorMaster(outputPath, svg) {
  const masterPath = masterPathForOutput(outputPath);
  await fs.writeFile(masterPath, String(svg || ''), 'utf8');
  return masterPath;
}

async function rerunVectorCleanup({ inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu Master SVG hoặc đường dẫn file đầu ra.');
  const profile = normalizeProfile(options.profile);
  onProgress?.(12, `Đang đọc Master SVG · ${profile}`);
  const masterSvg = await fs.readFile(inputPath, 'utf8');
  const before = inspectSvgComplexity(masterSvg);

  onProgress?.(48, 'Đang tối ưu path và Bézier mà không trace lại');
  const cleaned = cleanupVectorSvg(masterSvg, {
    profile,
    pathPrecision: Number(options.pathPrecision) || 3
  });
  const after = inspectSvgComplexity(cleaned.svg);
  await fs.writeFile(outputPath, cleaned.svg, 'utf8');

  const report = {
    profile,
    masterPath: inputPath,
    outputPath,
    nodesBefore: before.nodeEstimate,
    nodesAfter: after.nodeEstimate,
    nodeReduction: before.nodeEstimate > 0
      ? Number((((before.nodeEstimate - after.nodeEstimate) / before.nodeEstimate) * 100).toFixed(2))
      : 0,
    pathCountBefore: before.pathCount,
    pathCountAfter: after.pathCount,
    svgBytesBefore: before.svgBytes,
    svgBytesAfter: after.svgBytes,
    ...cleaned.stats
  };

  onProgress?.(100, `Cleanup ${profile} hoàn tất · ${before.nodeEstimate} → ${after.nodeEstimate} node`);
  return { outputPath, masterPath: inputPath, vectorCleanup: report };
}

module.exports = {
  CLEANUP_PROFILES,
  masterPathForOutput,
  normalizeProfile,
  rerunVectorCleanup,
  saveVectorMaster
};
