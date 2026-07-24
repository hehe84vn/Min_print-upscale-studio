'use strict';

const fs = require('node:fs/promises');
const sharp = require('sharp');

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function key(x, y) { return `${x},${y}`; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function colorKey(r, g, b) {
  return `${r},${g},${b}`;
}

function parseColorKey(value) {
  return value.split(',').map(Number);
}

function estimateBackground(data, info) {
  const counts = new Map();
  const add = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    const r = Math.round(data[offset] / 8) * 8;
    const g = Math.round(data[offset + 1] / 8) * 8;
    const b = Math.round(data[offset + 2] / 8) * 8;
    const id = colorKey(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
    counts.set(id, (counts.get(id) || 0) + 1);
  };
  const sx = Math.max(1, Math.floor(info.width / 100));
  const sy = Math.max(1, Math.floor(info.height / 100));
  for (let x = 0; x < info.width; x += sx) {
    add(x, 0); add(x, info.height - 1);
  }
  for (let y = sy; y < info.height - 1; y += sy) {
    add(0, y); add(info.width - 1, y);
  }
  return parseColorKey([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '255,255,255');
}

function quantizedPalette(data, info, maxColors = 12) {
  const counts = new Map();
  for (let i = 0; i < info.width * info.height; i += 1) {
    const offset = i * info.channels;
    if (info.channels >= 4 && data[offset + 3] < 128) continue;
    const r = Math.round(data[offset] / 16) * 16;
    const g = Math.round(data[offset + 1] / 16) * 16;
    const b = Math.round(data[offset + 2] / 16) * 16;
    const id = colorKey(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([id, count]) => ({ rgb: parseColorKey(id), count }));
}

function rgbDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function buildMask(data, info, target, tolerance = 42) {
  const mask = new Uint8Array(info.width * info.height);
  for (let i = 0; i < mask.length; i += 1) {
    const offset = i * info.channels;
    if (info.channels >= 4 && data[offset + 3] < 128) continue;
    const pixel = [data[offset], data[offset + 1], data[offset + 2]];
    if (rgbDistance(pixel, target) <= tolerance) mask[i] = 1;
  }
  return mask;
}

function addEdge(edges, ax, ay, bx, by) {
  const from = key(ax, ay);
  if (!edges.has(from)) edges.set(from, []);
  edges.get(from).push({ x: bx, y: by });
}

function boundaryEdges(mask, width, height) {
  const edges = new Map();
  const at = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge(edges, x, y, x + 1, y);
      if (!at(x + 1, y)) addEdge(edges, x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) addEdge(edges, x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) addEdge(edges, x, y + 1, x, y);
    }
  }
  return edges;
}

function stitchLoops(edges, minimumPoints = 12) {
  const loops = [];
  const takeNext = (from) => {
    const list = edges.get(from);
    if (!list?.length) return null;
    const next = list.pop();
    if (!list.length) edges.delete(from);
    return next;
  };
  while (edges.size) {
    const startKey = edges.keys().next().value;
    const [sx, sy] = startKey.split(',').map(Number);
    const loop = [{ x: sx, y: sy }];
    let currentKey = startKey;
    let guard = 0;
    while (guard < 1_000_000) {
      guard += 1;
      const next = takeNext(currentKey);
      if (!next) break;
      loop.push(next);
      currentKey = key(next.x, next.y);
      if (currentKey === startKey) break;
    }
    if (loop.length >= minimumPoints && currentKey === startKey) loops.push(loop);
  }
  return loops;
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-9) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator, 0, 1);
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  let maximum = -1;
  let index = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const deviation = pointLineDistance(points[i], points[0], points.at(-1));
    if (deviation > maximum) { maximum = deviation; index = i; }
  }
  if (maximum <= tolerance) return [points[0], points.at(-1)];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function angleDegrees(a, b, c) {
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu < 1e-9 || lv < 1e-9) return 180;
  return Math.acos(clamp((u.x * v.x + u.y * v.y) / (lu * lv), -1, 1)) * 180 / Math.PI;
}

function cubicFromChunk(points) {
  const start = points[0];
  const end = points.at(-1);
  const first = points[Math.min(2, points.length - 1)];
  const last = points[Math.max(0, points.length - 3)];
  const handle = distance(start, end) / 3;
  const d1 = Math.max(1e-9, distance(start, first));
  const d2 = Math.max(1e-9, distance(last, end));
  return {
    type: 'C', start,
    c1: { x: start.x + (first.x - start.x) / d1 * handle, y: start.y + (first.y - start.y) / d1 * handle },
    c2: { x: end.x + (last.x - end.x) / d2 * handle, y: end.y + (last.y - end.y) / d2 * handle },
    end
  };
}

function evaluateCubic(segment, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * segment.start.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t ** 3 * segment.end.x,
    y: u ** 3 * segment.start.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t ** 3 * segment.end.y
  };
}

function fitChunk(points, tolerance, depth = 0) {
  if (points.length <= 3) return points.slice(1).map((point, index) => ({ type: 'L', start: points[index], end: point }));
  const cubic = cubicFromChunk(points);
  let maximum = 0;
  let split = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const deviation = distance(points[i], evaluateCubic(cubic, i / (points.length - 1)));
    if (deviation > maximum) { maximum = deviation; split = i; }
  }
  if (maximum <= tolerance) return [cubic];
  if (depth >= 8 || split < 3 || points.length - split < 4) {
    return points.slice(1).map((point, index) => ({ type: 'L', start: points[index], end: point }));
  }
  return [...fitChunk(points.slice(0, split + 1), tolerance, depth + 1), ...fitChunk(points.slice(split), tolerance, depth + 1)];
}

function loopToSegments(loop, options = {}) {
  const scale = Number(options.coordinateScale || 1);
  const tolerance = Number(options.simplifyTolerance || 1.15);
  const fitTolerance = Number(options.fitTolerance || 1.8);
  const closed = loop.slice(0, -1).map((point) => ({ x: point.x * scale, y: point.y * scale }));
  if (closed.length < 8) return [];
  const simplified = simplify([...closed, closed[0]], tolerance * scale);
  const points = simplified.slice(0, -1);
  if (points.length < 4) return [];
  const corners = [0];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (angleDegrees(points[i - 1], points[i], points[i + 1]) < 138) corners.push(i);
  }
  corners.push(points.length);
  const segments = [{ type: 'M', end: points[0] }];
  for (let index = 0; index < corners.length - 1; index += 1) {
    const start = corners[index];
    const end = corners[index + 1];
    const chunk = [];
    for (let i = start; i <= end; i += 1) chunk.push(points[i % points.length]);
    segments.push(...fitChunk(chunk, fitTolerance * scale));
  }
  segments.push({ type: 'Z' });
  return segments;
}

function serializeSegments(segments, precision = 2) {
  const n = (value) => Number(value.toFixed(precision));
  return segments.map((segment) => {
    if (segment.type === 'M') return `M${n(segment.end.x)} ${n(segment.end.y)}`;
    if (segment.type === 'L') return `L${n(segment.end.x)} ${n(segment.end.y)}`;
    if (segment.type === 'C') return `C${n(segment.c1.x)} ${n(segment.c1.y)} ${n(segment.c2.x)} ${n(segment.c2.y)} ${n(segment.end.x)} ${n(segment.end.y)}`;
    return 'Z';
  }).join('');
}

function hex(rgb) {
  return `#${rgb.map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

async function vectorizeLogoPrecision({ inputPath, outputPath, options = {}, onProgress }) {
  const maximumDimension = clamp(Number(options.precisionMaxDimension || 1200), 400, 2400);
  onProgress?.(10, 'Logo Precision: đang chuẩn hóa màu và dựng contour');
  const raw = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize({ width: maximumDimension, height: maximumDimension, fit: 'inside', withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .blur(Number(options.precisionBlur ?? 0.35))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = estimateBackground(raw.data, raw.info);
  const palette = quantizedPalette(raw.data, raw.info, clamp(Number(options.precisionColors || 12), 2, 24));
  const scaleX = raw.info.width ? (Number(options.outputWidth || raw.info.width) / raw.info.width) : 1;
  const scaleY = raw.info.height ? (Number(options.outputHeight || raw.info.height) / raw.info.height) : 1;
  const coordinateScale = (scaleX + scaleY) / 2;
  const paths = [];
  let loopCount = 0;
  let cubicCount = 0;
  let lineCount = 0;

  for (const entry of palette) {
    if (rgbDistance(entry.rgb, background) < 30) continue;
    if (entry.count < raw.info.width * raw.info.height * 0.00008) continue;
    const mask = buildMask(raw.data, raw.info, entry.rgb, Number(options.colorTolerance || 38));
    const loops = stitchLoops(boundaryEdges(mask, raw.info.width, raw.info.height), Number(options.minimumContourPoints || 14));
    for (const loop of loops) {
      const segments = loopToSegments(loop, {
        coordinateScale,
        simplifyTolerance: Number(options.simplifyTolerance || 1.1),
        fitTolerance: Number(options.fitTolerance || 1.8)
      });
      if (!segments.length) continue;
      const d = serializeSegments(segments, 2);
      paths.push(`<path fill="${hex(entry.rgb)}" d="${d}"/>`);
      loopCount += 1;
      cubicCount += segments.filter((segment) => segment.type === 'C').length;
      lineCount += segments.filter((segment) => segment.type === 'L').length;
    }
  }

  if (!paths.length) throw new Error('Logo Precision không tìm thấy contour màu đủ ổn định.');
  const width = Math.round(raw.info.width * coordinateScale);
  const height = Math.round(raw.info.height * coordinateScale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join('')}</svg>`;
  await fs.writeFile(outputPath, svg, 'utf8');
  onProgress?.(90, `Logo Precision: ${loopCount} contour, ${cubicCount} cubic`);
  return {
    outputPath,
    vectorReport: {
      schemaVersion: 13,
      engine: 'logo-precision',
      strategy: 'precision-contour-reconstruction',
      qualityGate: { status: 'review' },
      paletteSize: palette.length,
      contourCount: loopCount,
      cubicCount,
      lineCount,
      background,
      warnings: ['Logo Precision V13 là candidate thử nghiệm; cần so sánh trực quan với VTracer/AutoTrace trước khi sản xuất.']
    }
  };
}

module.exports = {
  boundaryEdges,
  buildMask,
  fitChunk,
  loopToSegments,
  quantizedPalette,
  stitchLoops,
  vectorizeLogoPrecision
};
