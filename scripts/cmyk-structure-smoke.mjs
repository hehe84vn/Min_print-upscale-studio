import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { inspectTiffStructure } = require('../src/main/services/colorOutputService');

const workspace = await mkdtemp(path.join(os.tmpdir(), 'print-cmyk-structure-test-'));
const inputPath = path.join(workspace, 'rgba-input.png');
const outputPath = path.join(workspace, 'verified-cmyk.tif');

try {
  await sharp({
    create: {
      width: 96,
      height: 72,
      channels: 4,
      background: { r: 196, g: 38, b: 48, alpha: 1 }
    }
  })
    .png()
    .toFile(inputPath);

  await sharp(inputPath, { failOn: 'none' })
    .flatten({ background: '#ffffff' })
    .pipelineColourspace('rgb16')
    .withIccProfile('cmyk', { attach: true })
    .tiff({ compression: 'lzw', predictor: 'horizontal' })
    .toFile(outputPath);

  const structure = await inspectTiffStructure(outputPath);
  if (
    !structure.valid
    || structure.photometricInterpretation !== 5
    || structure.cmykChannels !== 4
    || !structure.hasIccTag
    || structure.iccProfile?.colorSpace !== 'CMYK'
  ) {
    throw new Error(`CMYK TIFF structural verification failed: ${JSON.stringify(structure)}`);
  }

  console.log(`CMYK TIFF structure OK: photometric=${structure.photometricInterpretation}, channels=${structure.cmykChannels}, ICC=${structure.iccProfile.colorSpace}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
