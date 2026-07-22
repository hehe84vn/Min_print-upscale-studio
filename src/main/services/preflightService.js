const sharp = require('sharp');
const { decodeBarcode, publicDetection } = require('./barcodeGuardService');

const PREFLIGHT_VERSION = 'preflight-v1';
const STATUS_RANK = { skipped: 0, pass: 1, warning: 2, fail: 3 };

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function percentile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * probability), 0, sorted.length - 1);
  return sorted[index];
}

function worstStatus(metrics) {
  let status = 'pass';
  for (const metric of Object.values(metrics)) {
    if (!metric || metric.status === 'skipped') continue;
    if (STATUS_RANK[metric.status] > STATUS_RANK[status]) status = metric.status;
  }
  return status;
}

function lumaFromRgb(rgb) {
  const pixels = rgb.length / 3;
  const luma = new Float32Array(pixels);
  for (let index = 0, pixel = 0; pixel < pixels; index += 3, pixel += 1) {
    luma[pixel] = rgb[index] * 0.2126 + rgb[index + 1] * 0.7152 + rgb[index + 2] * 0.0722;
  }
  return luma;
}

function sobel(luma, width, height) {
  const gradient = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const topLeft = luma[index - width - 1];
      const top = luma[index - width];
      const topRight = luma[index - width + 1];
      const left = luma[index - 1];
      const right = luma[index + 1];
      const bottomLeft = luma[index + width - 1];
      const bottom = luma[index + width];
      const bottomRight = luma[index + width + 1];
      const gx = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      gradient[index] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return gradient;
}

function sampledThreshold(gradient) {
  const samples = [];
  const step = Math.max(1, Math.floor(gradient.length / 50000));
  for (let index = 0; index < gradient.length; index += step) {
    if (gradient[index] > 2) samples.push(gradient[index]);
  }
  return Math.max(24, percentile(samples, 0.82));
}

function maxNeighbor(values, width, height, x, y) {
  let maximum = 0;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      maximum = Math.max(maximum, values[nextY * width + nextX]);
    }
  }
  return maximum;
}

function hasNeighborAbove(values, width, height, x, y, threshold) {
  return maxNeighbor(values, width, height, x, y) >= threshold;
}

function edgeAgreementMetric(sourceGradient, outputGradient, width, height, sourceThreshold, mask = null) {
  let sourceEdges = 0;
  let matchedEdges = 0;
  let outputEdges = 0;
  let falseEdges = 0;
  const matchThreshold = sourceThreshold * 0.72;
  const outputThreshold = sourceThreshold * 0.95;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (mask && mask[index] < 72) continue;

      const sourceIsEdge = sourceGradient[index] >= sourceThreshold;
      const outputIsEdge = outputGradient[index] >= outputThreshold;
      if (sourceIsEdge) {
        sourceEdges += 1;
        if (hasNeighborAbove(outputGradient, width, height, x, y, matchThreshold)) matchedEdges += 1;
      }
      if (outputIsEdge) {
        outputEdges += 1;
        if (!hasNeighborAbove(sourceGradient, width, height, x, y, sourceThreshold * 0.62)) falseEdges += 1;
      }
    }
  }

  const agreementPercent = sourceEdges ? (matchedEdges / sourceEdges) * 100 : 100;
  const falseEdgePercent = outputEdges ? (falseEdges / outputEdges) * 100 : 0;
  return {
    agreementPercent: round(agreementPercent),
    falseEdgePercent: round(falseEdgePercent),
    sourceEdgePixels: sourceEdges,
    outputEdgePixels: outputEdges
  };
}

function haloMetric(sourceGradient, outputGradient, width, height, sourceThreshold) {
  const gains = [];
  let adjacentPixels = 0;
  let ringingPixels = 0;

  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      if (sourceGradient[index] >= sourceThreshold) {
        gains.push((outputGradient[index] + 1) / (sourceGradient[index] + 1));
        continue;
      }

      if (
        sourceGradient[index] < sourceThreshold * 0.42
        && hasNeighborAbove(sourceGradient, width, height, x, y, sourceThreshold)
      ) {
        adjacentPixels += 1;
        if (outputGradient[index] >= sourceThreshold * 1.35) ringingPixels += 1;
      }
    }
  }

  return {
    edgeGainP90: round(percentile(gains, 0.9), 2),
    ringingPercent: round(adjacentPixels ? (ringingPixels / adjacentPixels) * 100 : 0),
    sampledEdges: gains.length
  };
}

function srgbChannelToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(red, green, blue) {
  const r = srgbChannelToLinear(red);
  const g = srgbChannelToLinear(green);
  const b = srgbChannelToLinear(blue);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const transform = (value) => value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function colorDriftMetric(sourceRgb, outputRgb) {
  const deltas = [];
  const pixels = sourceRgb.length / 3;
  const step = Math.max(1, Math.floor(pixels / 55000));
  let total = 0;
  let samples = 0;

  for (let pixel = 0; pixel < pixels; pixel += step) {
    const index = pixel * 3;
    const sourceLab = rgbToLab(sourceRgb[index], sourceRgb[index + 1], sourceRgb[index + 2]);
    const outputLab = rgbToLab(outputRgb[index], outputRgb[index + 1], outputRgb[index + 2]);
    const delta = Math.sqrt(
      (sourceLab[0] - outputLab[0]) ** 2
      + (sourceLab[1] - outputLab[1]) ** 2
      + (sourceLab[2] - outputLab[2]) ** 2
    );
    deltas.push(delta);
    total += delta;
    samples += 1;
  }

  return {
    meanDeltaE76: round(samples ? total / samples : 0, 2),
    p95DeltaE76: round(percentile(deltas, 0.95), 2),
    samples
  };
}

function statusForColor(value) {
  if (value.meanDeltaE76 > 6 || value.p95DeltaE76 > 16) return 'fail';
  if (value.meanDeltaE76 > 3.2 || value.p95DeltaE76 > 10) return 'warning';
  return 'pass';
}

function statusForGeometry(value) {
  if (value.agreementPercent < 78 || value.falseEdgePercent > 46) return 'fail';
  if (value.agreementPercent < 88 || value.falseEdgePercent > 30) return 'warning';
  return 'pass';
}

function statusForText(value) {
  if (!value.sourceEdgePixels) return 'skipped';
  if (value.agreementPercent < 80 || value.falseEdgePercent > 42) return 'fail';
  if (value.agreementPercent < 90 || value.falseEdgePercent > 27) return 'warning';
  return 'pass';
}

function statusForHalo(value) {
  if (value.edgeGainP90 > 2.7 || value.ringingPercent > 19) return 'fail';
  if (value.edgeGainP90 > 1.95 || value.ringingPercent > 10) return 'warning';
  return 'pass';
}

function maskCoverageMetric(protection) {
  if (!protection?.enabled) {
    return { status: 'skipped', coveragePercent: null, message: 'Không dùng protection mask.' };
  }
  const coveragePercent = Number(protection.coveragePercent || 0);
  let status = 'pass';
  let message = 'Mức phủ mask nằm trong vùng cân bằng.';
  if (coveragePercent < 5 || coveragePercent > 74) {
    status = 'fail';
    message = coveragePercent < 5 ? 'Mask bảo vệ quá ít.' : 'Mask phủ quá nhiều ảnh.';
  } else if (coveragePercent < 12 || coveragePercent > 58) {
    status = 'warning';
    message = coveragePercent < 12 ? 'Mask có thể bỏ sót chữ/cạnh.' : 'Mask có thể đang khóa quá nhiều texture.';
  }
  return { status, coveragePercent: round(coveragePercent), message };
}

async function loadRgb(filePath, width, height) {
  const { data } = await sharp(filePath, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function loadMask(filePath, width, height) {
  if (!filePath) return null;
  try {
    return await sharp(filePath, { failOn: 'none' })
      .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}

async function createPreflightContext(sourcePath, maxDimension = 900) {
  const metadata = await sharp(sourcePath, { failOn: 'none' }).rotate().metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được ảnh nguồn để chạy Packaging Preflight.');
  const scale = Math.min(1, maxDimension / Math.max(metadata.width, metadata.height));
  const width = Math.max(64, Math.round(metadata.width * scale));
  const height = Math.max(64, Math.round(metadata.height * scale));
  const sourceRgb = await loadRgb(sourcePath, width, height);
  const sourceLuma = lumaFromRgb(sourceRgb);
  const sourceGradient = sobel(sourceLuma, width, height);
  return {
    sourcePath,
    width,
    height,
    sourceRgb,
    sourceGradient,
    sourceEdgeThreshold: sampledThreshold(sourceGradient),
    sourceBarcode: await decodeBarcode(sourcePath)
  };
}

function barcodeMetric(source, output) {
  if (!source?.detected) {
    return {
      status: 'skipped',
      source: publicDetection(source),
      output: publicDetection(output),
      message: 'Ảnh nguồn không có QR/barcode được phát hiện.'
    };
  }

  if (source.visualOnly) {
    const preserved = Boolean(output?.detected);
    return {
      status: preserved ? 'warning' : 'fail',
      source: publicDetection(source),
      output: publicDetection(output),
      message: preserved
        ? 'Vùng giống barcode vẫn tồn tại nhưng mã nguồn chưa xác thực/checksum không hợp lệ.'
        : 'Vùng barcode-like từ ảnh nguồn không còn được phát hiện sau xử lý.'
    };
  }

  const matches = output?.detected
    && !output.visualOnly
    && output.valueHash === source.valueHash
    && output.format === source.format;
  return {
    status: matches ? 'pass' : 'fail',
    source: publicDetection(source),
    output: publicDetection(output),
    message: matches ? 'QR/barcode giữ đúng nội dung và định dạng.' : 'QR/barcode không còn đọc đúng như ảnh nguồn.'
  };
}

function recommendationFor(metrics) {
  const recommendations = [];
  if (metrics.barcode?.status === 'fail') recommendations.push('Khôi phục vùng QR/barcode từ ảnh nguồn hoặc dùng Current · Packaging.');
  if (metrics.textLogo?.status === 'fail') recommendations.push('Tăng protection sensitivity hoặc giảm Detail Strength.');
  if (metrics.geometry?.status === 'fail') recommendations.push('Ưu tiên Current · High Fidelity/Packaging để giữ hình học.');
  if (metrics.halo?.status === 'fail') recommendations.push('Giảm Detail Strength xuống khoảng 10–15%.');
  if (metrics.color?.status === 'fail') recommendations.push('Kiểm tra màu với ảnh nguồn và tránh dùng pipeline Detail cho artwork màu phẳng.');
  if (metrics.maskCoverage?.status === 'fail') {
    recommendations.push(metrics.maskCoverage.coveragePercent > 74
      ? 'Giảm protection sensitivity để tránh khóa quá nhiều texture.'
      : 'Tăng protection sensitivity để phủ đủ chữ, logo và cạnh.');
  }
  if (!recommendations.length && Object.values(metrics).some((metric) => metric?.status === 'warning')) {
    recommendations.push('Kiểm tra trực quan ở 200–400% trước khi duyệt artwork.');
  }
  if (!recommendations.length) recommendations.push('Kết quả nằm trong ngưỡng preflight hiện tại.');
  return recommendations;
}

async function runPackagingPreflight({ context, outputPath, semanticMaskPath = null, protection = null }) {
  if (!context?.sourceRgb || !context?.sourceGradient) throw new Error('Thiếu preflight context của ảnh nguồn.');
  if (!outputPath) throw new Error('Thiếu ảnh kết quả để chạy Packaging Preflight.');

  const outputRgb = await loadRgb(outputPath, context.width, context.height);
  const outputLuma = lumaFromRgb(outputRgb);
  const outputGradient = sobel(outputLuma, context.width, context.height);
  const semanticMask = await loadMask(semanticMaskPath, context.width, context.height);

  const colorValue = colorDriftMetric(context.sourceRgb, outputRgb);
  const geometryValue = edgeAgreementMetric(
    context.sourceGradient,
    outputGradient,
    context.width,
    context.height,
    context.sourceEdgeThreshold
  );
  const textValue = semanticMask
    ? edgeAgreementMetric(
      context.sourceGradient,
      outputGradient,
      context.width,
      context.height,
      context.sourceEdgeThreshold * 0.82,
      semanticMask
    )
    : null;
  const haloValue = haloMetric(
    context.sourceGradient,
    outputGradient,
    context.width,
    context.height,
    context.sourceEdgeThreshold
  );
  const outputBarcode = await decodeBarcode(outputPath);

  const metrics = {
    barcode: barcodeMetric(context.sourceBarcode, outputBarcode),
    color: {
      status: statusForColor(colorValue),
      ...colorValue,
      message: 'Độ lệch màu được ước lượng bằng ΔE76 sau khi chuẩn hóa cùng kích thước.'
    },
    geometry: {
      status: statusForGeometry(geometryValue),
      ...geometryValue,
      message: 'So khớp cạnh nguồn/kết quả và tỷ lệ cạnh phát sinh.'
    },
    textLogo: textValue ? {
      status: statusForText(textValue),
      ...textValue,
      message: 'Độ ổn định cạnh trong vùng Text/Logo Semantic Mask.'
    } : {
      status: 'skipped',
      agreementPercent: null,
      falseEdgePercent: null,
      message: 'Không có semantic mask cho pipeline này.'
    },
    halo: {
      status: statusForHalo(haloValue),
      ...haloValue,
      message: 'Đánh giá mức tăng năng lượng cạnh và ringing quanh biên.'
    },
    maskCoverage: maskCoverageMetric(protection)
  };

  const status = worstStatus(metrics);
  const warningCount = Object.values(metrics).filter((metric) => metric?.status === 'warning').length;
  const failCount = Object.values(metrics).filter((metric) => metric?.status === 'fail').length;
  const score = clamp(100 - warningCount * 12 - failCount * 32, 0, 100);

  return {
    version: PREFLIGHT_VERSION,
    status,
    score,
    analysis: { width: context.width, height: context.height },
    metrics,
    recommendations: recommendationFor(metrics)
  };
}

module.exports = {
  PREFLIGHT_VERSION,
  createPreflightContext,
  runPackagingPreflight
};
