'use strict';

const fs = require('node:fs/promises');
const { saveVectorMaster } = require('./vectorCleanupRerunService');
const { rerunVectorCleanup } = require('./vectorCleanupRerunService');

async function selectVectorCandidate({ inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu candidate SVG hoặc đường dẫn file đầu ra.');

  onProgress?.(8, 'Đang đọc candidate SVG đã lưu');
  const candidateSvg = await fs.readFile(inputPath, 'utf8');
  if (!/<svg\b/i.test(candidateSvg)) throw new Error('Candidate không phải SVG hợp lệ.');

  onProgress?.(18, 'Đang đặt candidate làm Master SVG mới');
  const masterPath = await saveVectorMaster(outputPath, candidateSvg);

  const cleaned = await rerunVectorCleanup({
    inputPath: masterPath,
    outputPath,
    options: {
      profile: options.profile || 'auto',
      pathPrecision: Number(options.pathPrecision) || 3,
      visualValidation: options.visualValidation !== false,
      visualValidationOptions: options.visualValidationOptions || {}
    },
    onProgress: (percent, message) => onProgress?.(20 + Math.round(percent * 0.8), message)
  });

  return {
    ...cleaned,
    candidatePath: inputPath,
    candidateId: options.candidateId || null,
    engine: options.engine || null,
    selectedWithoutRetrace: true
  };
}

module.exports = { selectVectorCandidate };
