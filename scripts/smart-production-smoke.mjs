import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const {
  MAX_SCALE,
  analyzeImage,
  calculateTargetPlan,
  normalizeFixedScale
} = require('../src/main/services/smartAnalyzerService');
const { ensureScale } = require('../src/main/services/imageService');
const { normalizeBatchSettings } = require('../src/main/services/productionWorkflowService');

const workspace = await mkdtemp(path.join(os.tmpdir(), 'print-smart-production-smoke-'));
const inputPath = path.join(workspace, 'packaging-sample.png');

try {
  const source = Buffer.from(`
    <svg width="120" height="90" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="90" fill="#f4f0df"/>
      <rect x="8" y="8" width="104" height="74" fill="none" stroke="#153f28" stroke-width="3"/>
      <text x="15" y="36" font-size="17" font-family="sans-serif" fill="#153f28">PACK 01</text>
      <g fill="#111">
        <rect x="16" y="50" width="2" height="25"/><rect x="21" y="50" width="4" height="25"/>
        <rect x="29" y="50" width="2" height="25"/><rect x="35" y="50" width="3" height="25"/>
        <rect x="42" y="50" width="1" height="25"/><rect x="47" y="50" width="4" height="25"/>
      </g>
    </svg>
  `);
  await sharp(source).png().toFile(inputPath);

  if (MAX_SCALE !== 8 || ensureScale(16) !== 8 || ensureScale(0.2) !== 1) {
    throw new Error('Hard scale limit is not enforced at 8x.');
  }
  if (normalizeFixedScale(6) !== 6 || normalizeFixedScale(7) !== 2) {
    throw new Error('Fixed scale normalization is invalid.');
  }

  const analysis = await analyzeImage(inputPath, { scale: 8, format: 'tiff', cmyk: true });
  if (analysis.selectedScale !== 8 || analysis.output.width !== 960 || analysis.output.height !== 720) {
    throw new Error(`Smart Analyzer returned unexpected output: ${JSON.stringify(analysis.output)}`);
  }
  if (!analysis.recommendation?.model || analysis.output.megapixels <= 0) {
    throw new Error('Smart Analyzer recommendation or estimate is missing.');
  }

  const oversized = calculateTargetPlan({
    inputWidth: 120,
    inputHeight: 90,
    width: 100,
    height: 75,
    unit: 'cm',
    dpi: 300
  });
  if (!oversized.exceedsScaleLimit || oversized.appliedScale !== 8) {
    throw new Error('Target Print Size did not stop at the 8x hard limit.');
  }

  const settings = normalizeBatchSettings({
    outputMode: 'fixed-scale',
    fixedScale: 8,
    format: 'tiff',
    cmykEnabled: true,
    qualityCheckEnabled: true
  });
  if (settings.fixedScale !== 8 || settings.format !== 'tiff' || !settings.cmykEnabled) {
    throw new Error('Batch settings normalization failed.');
  }

  console.log(`Smart Production OK: ${analysis.classification}, ${analysis.recommendation.model}, ${analysis.selectedScale}x`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
