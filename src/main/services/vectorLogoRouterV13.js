'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const legacy = require('./vectorLogoService');
const { vectorizeLogoPrecision } = require('./logoPrecisionEngineService');

async function vectorizeLogo(payload) {
  const options = payload.options || {};
  const precisionRequested = options.vectorEngine === 'logo-precision' || options.colorMode === 'precision';
  if (!precisionRequested) return legacy.vectorizeLogo(payload);

  const result = await vectorizeLogoPrecision({
    inputPath: payload.inputPath,
    outputPath: payload.outputPath,
    options,
    onProgress: payload.onProgress
  });
  const reportPath = path.join(
    path.dirname(payload.outputPath),
    `${path.basename(payload.outputPath, path.extname(payload.outputPath))}-vector-report.json`
  );
  result.reportPath = reportPath;
  result.vectorReport.inputPath = payload.inputPath;
  result.vectorReport.outputPath = payload.outputPath;
  await fs.writeFile(reportPath, JSON.stringify(result.vectorReport, null, 2), 'utf8');
  return result;
}

module.exports = {
  ...legacy,
  vectorizeLogo
};
