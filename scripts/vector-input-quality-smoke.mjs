import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import qualityModule from '../src/main/services/vectorInputQualityService.js';

const { analyzeVectorInput, formatVectorInputRejection } = qualityModule;
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

  console.log(`Vector Input Gate OK: crisp ${crisp.gate.status} ${crisp.gate.score}, soft ${soft.gate.status} ${soft.gate.score}.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}