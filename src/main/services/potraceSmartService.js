'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { compareBinaryComponents } = require('./binaryShapeReconstruction');
const { inspectSvgComplexity } = require('./vectorLogoEngine');
const {
  buildPotraceCandidate,
  selectedPotracePresets
} = require('./potraceVectorEngine');

const REVIEW_SIZE = 720;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function compareBinaryPixels(source, rendered) {
  let same = 0;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < source.length; index += 1) {
    const sourceForeground = source[index] < 128;
    const renderedForeground = rendered[index] < 128;
    if (sourceForeground === renderedForeground) same += 1;
    if (sourceForeground && renderedForeground) intersection += 1;
    if (sourceForeground || renderedForeground) union += 1;
  }
  return {
    pixelAgreement: Number((same / Math.max(1, source.length) * 100).toFixed(2)),
    foregroundIoU: Number((intersection / Math.max(1, union) * 100).toFixed(2))
  };
}

async function prepareBinarySource(inputPath, outputPath, sourceAnalysis, options = {}) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước logo đơn sắc.');
  const threshold = options.colorMode === 'binary'
    ? Number(options.threshold || 170)
    : Number(sourceAnalysis?.threshold || 170);
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .threshold(clamp(threshold, 0, 255));
  if (options.invert) pipeline = pipeline.negate();
  await pipeline.png({ palette: true, colours: 2, dither: 0, compressionLevel: 7 }).toFile(outputPath);
  return {
    width: metadata.width,
    height: metadata.height,
    traceWidth: metadata.width,
    traceHeight: metadata.height,
    traceScale: 1,
    threshold,
    format: metadata.format || path.extname(inputPath).slice(1)
  };
}

async function buildReference(binaryPath) {
  return sharp(binaryPath, { failOn: 'none' })
    .resize({ width: REVIEW_SIZE, height: REVIEW_SIZE, fit: 'inside', withoutEnlargement: false, kernel: sharp.kernel.nearest })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function assessCandidate(svg, reference) {
  const rendered = await sharp(Buffer.from(svg), { density: 144, failOn: 'none' })
    .flatten({ background: '#ffffff' })
    .resize(reference.info.width, reference.info.height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();
  const complexity = inspectSvgComplexity(svg);
  const componentValidation = compareBinaryComponents(reference.data, rendered, reference.info);
  return {
    ...compareBinaryPixels(reference.data, rendered),
    ...complexity,
    componentValidation
  };
}

function rankCandidates(candidates) {
  const nodeCounts = candidates.map((candidate) => candidate.metrics.nodeEstimate || 1);
  const minimum = Math.min(...nodeCounts);
  const maximum = Math.max(...nodeCounts);
  for (const candidate of candidates) {
    const nodes = candidate.metrics.nodeEstimate || 1;
    const simplicity = maximum === minimum ? 100 : 100 - ((nodes - minimum) / (maximum - minimum)) * 100;
    const local = candidate.metrics.componentValidation;
    candidate.metrics.simplicityScore = Number(simplicity.toFixed(2));
    candidate.score = Number((
      candidate.metrics.foregroundIoU * 0.25
      + candidate.metrics.pixelAgreement * 0.10
      + local.weightedComponentIoU * 0.30
      + local.p10ComponentIoU * 0.15
      + local.worstComponentIoU * 0.15
      + simplicity * 0.05
    ).toFixed(2));
    candidate.rejected = local.unmatchedSourceComponents > 0 || candidate.metrics.colorCount > 2;
    candidate.rejectedReason = local.unmatchedSourceComponents > 0
      ? `Mất ${local.unmatchedSourceComponents} component nguồn.`
      : candidate.metrics.colorCount > 2
        ? `SVG đơn sắc có ${candidate.metrics.colorCount} màu.`
        : null;
  }
  return candidates.sort((left, right) => {
    if (left.rejected !== right.rejected) return left.rejected ? 1 : -1;
    return right.score - left.score;
  });
}

async function vectorizeMonochromeWithPotrace({ inputPath, outputPath, options = {}, sourceAnalysis, onProgress }) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-potrace-'));
  const binaryPath = path.join(workspace, 'potrace-source.png');
  try {
    onProgress?.(10, 'Đang chuẩn hóa ảnh đơn sắc cho Potrace');
    const source = await prepareBinarySource(inputPath, binaryPath, sourceAnalysis, options);
    const reference = await buildReference(binaryPath);
    const { optimize } = await import('@neplex/vectorizer');
    const presets = selectedPotracePresets(options.strategy || 'smart');
    const candidates = [];
    const candidateErrors = [];

    for (let index = 0; index < presets.length; index += 1) {
      const preset = presets[index];
      onProgress?.(20 + Math.round(index / presets.length * 55), `${index + 1}/${presets.length}: ${preset.label}`);
      try {
        candidates.push(await buildPotraceCandidate({
          inputPath: binaryPath,
          preset,
          source,
          optimize,
          assessSvg: (svg) => assessCandidate(svg, reference)
        }));
      } catch (error) {
        candidateErrors.push({ id: preset.id, error: error.message || String(error) });
      }
    }

    if (!candidates.length) {
      const error = new Error(`Potrace không tạo được candidate. ${candidateErrors.map((item) => `${item.id}: ${item.error}`).join(' | ')}`);
      error.code = candidateErrors.some((item) => item.error.includes('runtime chưa được cài'))
        ? 'POTRACE_RUNTIME_MISSING'
        : 'POTRACE_FAILED';
      throw error;
    }

    onProgress?.(82, 'Đang so sánh fidelity và component của các candidate Potrace');
    const ranked = rankCandidates(candidates);
    const selected = ranked.find((candidate) => !candidate.rejected) || ranked[0];
    await fs.writeFile(outputPath, selected.svg, 'utf8');

    const warnings = [];
    const local = selected.metrics.componentValidation;
    if (local.worstComponentIoU < 88) warnings.push(`Component yếu nhất đạt ${local.worstComponentIoU}%; cần kiểm tra chi tiết nhỏ.`);
    if (local.p10ComponentIoU < 91) warnings.push(`10% component yếu nhất đạt ${local.p10ComponentIoU}%.`);
    if (selected.metrics.foregroundIoU < 94) warnings.push(`Foreground IoU ${selected.metrics.foregroundIoU}%; biên có thể sai lệch.`);
    if (selected.metrics.nodeEstimate > 4500) warnings.push(`SVG có khoảng ${selected.metrics.nodeEstimate} node; nên dùng preset Cân bằng.`);

    const reportPath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.vector-report.json`);
    const report = {
      schemaVersion: 5,
      createdAt: new Date().toISOString(),
      inputPath,
      outputPath,
      engineRouter: {
        selectedEngine: 'potrace',
        fallbackEngine: 'vtracer',
        sourceType: 'monochrome'
      },
      requestedColorMode: options.colorMode || 'color',
      effectiveColorMode: 'binary',
      autoMonochrome: options.colorMode !== 'binary',
      threshold: source.threshold,
      source: { ...source, analysis: sourceAnalysis || null },
      selectedCandidate: selected.id,
      selectedScore: selected.score,
      qualityGate: {
        status: warnings.length ? 'review' : 'pass',
        foregroundIoU: selected.metrics.foregroundIoU,
        worstComponentIoU: local.worstComponentIoU,
        p10ComponentIoU: local.p10ComponentIoU,
        unmatchedSourceComponents: local.unmatchedSourceComponents
      },
      warnings,
      candidates: ranked.map(({ svg, ...candidate }) => candidate),
      candidateErrors,
      licenseNotice: 'Potrace-compatible Node engine is GPL-2.0. Review distribution licensing before commercial release.'
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    onProgress?.(100, `Hoàn tất · ${selected.label} · IoU ${selected.metrics.foregroundIoU}% · khoảng ${selected.metrics.nodeEstimate} node`);
    return { outputPath, reportPath, vectorReport: report };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  assessCandidate,
  prepareBinarySource,
  rankCandidates,
  vectorizeMonochromeWithPotrace
};
