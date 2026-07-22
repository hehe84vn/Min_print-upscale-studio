import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import qualityModule from '../src/main/services/vectorInputQualityService.js';
import vectorModule from '../src/main/services/vectorLogoService.js';

const { analyzeVectorInput, formatVectorInputRejection } = qualityModule;
const { applyConservativeInputPolicy } = vectorModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-input-quality-'));
const crispPath = path.join(workspace, 'crisp-logo.png');
const softPath = path.join(workspace, 'soft-small-logo.jpg');

try {
  const crispSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
      <rect width="1200" height="700" fill="#fff"/>
      <path fill="#000" fill-rule="evenodd" d="M120 100H360V170H205V300H345V370H205V600H120ZM455 100H605C715 100 790 185 790 350S715 600 605 600H455ZM535 185H600C665 185 705 240 705 350S665 515 600 515H535ZM865 100H955V520H1080V600H865Z"/>
    </svg>
  `);
  await sharp(crispSvg).png().toFile(crispPath);

  await sharp(crispSvg)
    .resize(190, 111, { kernel: sharp.kernel.lanczos3 })
    .blur(4.8)
    .jpeg({ quality: 34, chromaSubsampling: '4:2:0' })
    .toFile(softPath);

  const crisp = await analyzeVectorInput(crispPath);
  const soft = await analyzeVectorInput(softPath);

  assert.notEqual(crisp.gate.status, 'reject', JSON.stringify(crisp, null, 2));
  assert.ok(crisp.logoBounds.width >= 800);
  assert.ok(crisp.edge.sharpnessScore > soft.edge.sharpnessScore);
  assert.equal(soft.gate.status, 'reject', JSON.stringify(soft, null, 2));
  assert.ok(soft.gate.reasons.length > 0);
  assert.match(formatVectorInputRejection(soft), /Không thể vector hóa đáng tin cậy/);

  const smallCrisp = applyConservativeInputPolicy({
    logoBounds: { width: 73, height: 54 },
    contrastRange: 255,
    foregroundCoveragePercent: 32.31,
    edge: { sharpnessScore: 77.04, transitionWidthPx: 2.19 },
    stroke: { minimumStrokePx: 5 },
    gate: {
      status: 'reject',
      score: 39.7,
      reasons: ['Vùng logo chỉ dài 73px, không đủ dữ liệu hình học.'],
      warnings: []
    }
  });
  assert.equal(smallCrisp.gate.status, 'review', JSON.stringify(smallCrisp, null, 2));
  assert.equal(smallCrisp.gate.policy, 'downgraded-to-review');
  assert.equal(smallCrisp.gate.sizeRisk, true);
  assert.equal(smallCrisp.gate.severeSignalCount, 0);
  assert.ok(smallCrisp.gate.warnings.some((warning) => warning.includes('73px')));

  const smallDestroyed = applyConservativeInputPolicy({
    logoBounds: { width: 73, height: 54 },
    contrastRange: 24,
    foregroundCoveragePercent: 0.08,
    edge: { sharpnessScore: 9, transitionWidthPx: 7.2 },
    stroke: { minimumStrokePx: 1.1 },
    gate: {
      status: 'reject',
      score: 18,
      reasons: ['Ảnh mất dữ liệu hình học.'],
      warnings: []
    }
  });
  assert.equal(smallDestroyed.gate.status, 'reject', JSON.stringify(smallDestroyed, null, 2));
  assert.equal(smallDestroyed.gate.policy, 'conservative-reject');
  assert.ok(smallDestroyed.gate.severeSignalCount >= 2);

  console.log(`Vector Input Gate OK: crisp ${crisp.gate.status} ${crisp.gate.score}, soft ${soft.gate.status} ${soft.gate.score}, small crisp ${smallCrisp.gate.status}.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}