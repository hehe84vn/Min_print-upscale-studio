import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import precisionModule from '../src/main/services/logoPrecisionEngineService.js';

const { vectorizeLogoPrecision } = precisionModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'logo-precision-smoke-'));
const inputPath = path.join(workspace, 'input.png');
const outputPath = path.join(workspace, 'output.svg');

try {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
    <rect width="320" height="240" fill="#fff"/>
    <path d="M35 195L155 25L285 195Z" fill="none" stroke="#555" stroke-width="14" stroke-linejoin="round"/>
    <path d="M55 170C105 105 210 95 270 165C205 125 120 130 55 170Z" fill="#22aede"/>
    <path d="M72 150C125 105 205 115 255 72C235 130 135 135 72 150Z" fill="#ed1b2e"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(inputPath);
  const result = await vectorizeLogoPrecision({
    inputPath,
    outputPath,
    options: { precisionColors: 8, precisionMaxDimension: 640, fitTolerance: 2.2 }
  });
  const output = await fs.readFile(outputPath, 'utf8');
  assert.equal(result.vectorReport.engine, 'logo-precision');
  assert.ok(result.vectorReport.contourCount >= 3, 'Precision engine must recover multiple flat-color contours.');
  assert.ok(result.vectorReport.cubicCount > 0, 'Curved artwork must be represented with cubic Bezier segments.');
  assert.match(output, /<path/);
  assert.match(output, /C[-\d. ]+/);
  assert.ok(result.vectorReport.lineCount < 500, 'Precision output must not degrade into thousands of polygon nodes.');
  console.log(`Logo Precision V13 OK: ${result.vectorReport.contourCount} contours, ${result.vectorReport.cubicCount} cubic, ${result.vectorReport.lineCount} lines.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
