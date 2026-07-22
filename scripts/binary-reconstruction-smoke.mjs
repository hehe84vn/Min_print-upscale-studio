import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import reconstructionModule from '../src/main/services/binaryShapeReconstruction.js';

const { compareBinaryComponents, reconstructBinarySvg } = reconstructionModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'binary-reconstruction-smoke-'));
const sourcePath = path.join(workspace, 'binary-source.png');

try {
  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420">
      <rect width="900" height="420" fill="#fff"/>
      <path fill="#000" fill-rule="evenodd" d="
        M60 55H210V105H115V185H200V235H115V355H60Z
        M280 55H390C455 55 495 100 495 205S455 355 390 355H280Z
        M335 115H382C416 115 435 145 435 205S416 295 382 295H335Z
        M555 80H610V132H555Z
        M540 160H625V210H600V355H560V210H540Z
        M690 55H750V355H690Z
      "/>
    </svg>
  `);
  await sharp(artwork)
    .jpeg({ quality: 82, chromaSubsampling: '4:4:4' })
    .grayscale()
    .threshold(150)
    .png({ palette: true, colours: 2, dither: 0 })
    .toFile(sourcePath);

  const reconstruction = await reconstructBinarySvg(sourcePath, {
    outputWidth: 900,
    outputHeight: 420
  });
  assert.match(reconstruction.svg, /fill-rule="evenodd"/);
  assert.doesNotMatch(reconstruction.svg, /[CQTA]/);
  assert.ok(reconstruction.stats.loopCount >= 5);
  assert.ok(reconstruction.stats.simplifiedNodes < reconstruction.stats.sourceNodes);
  assert.ok(reconstruction.stats.rectilinearLoops >= 3);
  assert.ok(reconstruction.stats.nodeReductionPercent > 80);

  const source = await sharp(sourcePath).grayscale().raw().toBuffer({ resolveWithObject: true });
  const rendered = await sharp(Buffer.from(reconstruction.svg))
    .flatten({ background: '#fff' })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();
  const validation = compareBinaryComponents(source.data, rendered, source.info, { minimumPixels: 8 });
  assert.ok(validation.sourceComponentCount >= 4);
  assert.ok(validation.worstComponentIoU >= 88, `worst component IoU ${validation.worstComponentIoU}`);
  assert.ok(validation.p10ComponentIoU >= 90, `p10 component IoU ${validation.p10ComponentIoU}`);
  assert.equal(validation.unmatchedSourceComponents, 0);

  console.log(`Binary Reconstruction OK: ${reconstruction.stats.loopCount} contours, worst ${validation.worstComponentIoU}%, P10 ${validation.p10ComponentIoU}%.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}