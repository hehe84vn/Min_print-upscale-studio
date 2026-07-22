import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import runtimeModule from '../src/main/services/autotraceRuntimeService.js';
import autoTraceModule from '../src/main/services/autotraceSplineCandidateService.js';
import qualityModule from '../src/main/services/colorVectorQualityService.js';
import routerModule from '../src/main/services/colorVectorRouterService.js';
import vectorModule from '../src/main/services/vectorLogoEngine.js';

const { detectAutoTraceRuntime } = runtimeModule;
const { buildAutoTraceColorCandidate, prepareFlatPalettePng } = autoTraceModule;
const { inspectColorVectorQuality, rankColorCandidates, svgColorCount } = qualityModule;
const { routedVTracerStrategy, sanitizeColorCandidate } = routerModule;
const { scoreCandidates } = vectorModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-vector-smoke-'));
const inputPath = path.join(workspace, 'flat-color-source.png');
const palettePath = path.join(workspace, 'flat-color-palette.png');

try {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    const runtime = detectAutoTraceRuntime({ platform, arch, probe: false });
    assert.equal(runtime.supportedTarget, true, `${platform}-${arch} must be recognized`);
    assert.equal(runtime.runtimeType, 'external-executable');
    assert.equal(runtime.binaryRequired, true);
  }
  assert.equal(detectAutoTraceRuntime({ platform: 'linux', arch: 'arm64', probe: false }).supportedTarget, false);
  assert.equal(routedVTracerStrategy('smart'), 'detail', 'Smart VTracer route must exclude polygon compact preset');
  assert.equal(routedVTracerStrategy('balanced'), 'balanced');

  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="760" height="460" viewBox="0 0 760 460">
      <rect width="760" height="460" fill="#fff"/>
      <ellipse cx="250" cy="230" rx="190" ry="145" fill="#173f5f"/>
      <ellipse cx="250" cy="230" rx="112" ry="72" fill="#f6d55c"/>
      <path d="M410 90C590 80 690 180 650 310C620 405 485 410 405 330C510 345 575 300 575 230C575 165 515 125 410 145Z" fill="#ed553b"/>
      <path d="M40 405C190 330 570 330 720 405C550 455 210 455 40 405Z" fill="#c87536"/>
      <circle cx="610" cy="105" r="38" fill="#3caea3"/>
    </svg>
  `);
  await sharp(artwork).png().toFile(inputPath);
  const source = await prepareFlatPalettePng(inputPath, palettePath, { paletteColors: 8 });
  const palette = await fs.readFile(palettePath);
  assert.deepEqual([...palette.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(source.width, 760);
  assert.equal(source.height, 460);
  assert.equal(source.inputFormat, 'png-palette');
  assert.equal(source.cliInputHandler, 'png');
  assert.equal(source.quantization, 'sharp-palette-no-dither');
  assert.ok(source.actualPaletteColors <= 8, `quantized palette must stay <= 8, got ${source.actualPaletteColors}`);

  const stylePaletteSvg = '<svg><style>.green{fill:#65ae4c}.orange{fill:#c4723a;stroke:none}</style><path class="green" d="M0 0L10 0Z"/><path style="fill:#fff" d="M0 1L10 1Z"/></svg>';
  assert.equal(svgColorCount(stylePaletteSvg), 3, 'palette parser must read CSS classes and inline style declarations');

  const smoothSvg = '<svg><path fill="#173f5f" d="M20 20C80 0 140 40 120 100C90 150 25 130 20 20Z"/></svg>';
  const jaggedPath = `M0 0${'h1v1'.repeat(1600)}Z`;
  const jaggedSvg = `<svg><path fill="#173f5f" d="${jaggedPath}"/></svg>`;
  const smoothQuality = inspectColorVectorQuality(smoothSvg, { requestedColors: 8, colorCount: 5, edgeRecall: 82, edgeAgreement: 84 });
  const jaggedQuality = inspectColorVectorQuality(jaggedSvg, { requestedColors: 8, colorCount: 120, edgeRecall: 76, edgeAgreement: 80 });
  assert.ok(smoothQuality.curveFitScore >= 80);
  assert.equal(smoothQuality.rejected, false);
  assert.equal(jaggedQuality.stairStepRisk, true);
  assert.equal(jaggedQuality.paletteOverflow, true);
  assert.equal(jaggedQuality.rejected, true);

  const unknownPalette = inspectColorVectorQuality('<svg><path d="M0 0L10 0Z"/></svg>', { requestedColors: 8, edgeRecall: 80, edgeAgreement: 80 });
  assert.equal(unknownPalette.paletteValidationAvailable, false);
  assert.equal(unknownPalette.paletteScore, 0);
  assert.equal(unknownPalette.rejected, true);

  const sanitized = sanitizeColorCandidate({ metrics: { componentScore: 100, componentValidation: { worstComponentIoU: 100 } } });
  assert.equal(sanitized.metrics.componentScore, null);
  assert.equal(sanitized.metrics.componentValidation.available, false);
  assert.equal(sanitized.metrics.componentValidation.worstComponentIoU, null);

  const ranked = rankColorCandidates([
    {
      id: 'smooth', engine: 'vtracer', svg: smoothSvg,
      preprocessing: { paletteColors: 8 },
      metrics: { fidelity: 94, edgeAgreement: 82, edgeRecall: 81, nodeEstimate: 40, shapeCount: 1, colorCount: 5 }
    },
    {
      id: 'jagged', engine: 'vtracer', svg: jaggedSvg,
      preprocessing: { paletteColors: 8 },
      metrics: { fidelity: 98, edgeAgreement: 90, edgeRecall: 82, nodeEstimate: 3200, shapeCount: 1, colorCount: 120 }
    }
  ], 'smart', scoreCandidates);
  assert.equal(ranked[0].id, 'smooth', 'curve-safe selector must reject a higher-fidelity staircase candidate');
  assert.equal(ranked[1].rejected, true);

  const balancedReportSvg = '<svg><style>.g{fill:#65ae4c}.o{fill:#c4723a}.w{fill:#fff}.k{fill:#000}</style><path class="g" d="M0 0C20 0 40 20 40 40Z"/><path class="o" d="M0 50C20 45 40 45 60 50Z"/></svg>';
  const autoTraceReportSvg = `<svg><style>.g{fill:#65ae4c}.o{fill:#c4723a}.w{fill:#fff}.k{fill:#000}</style><path class="g" d="M0 0${'L1 1'.repeat(900)}${'C1 1 2 2 3 3'.repeat(40)}Z"/></svg>`;
  const reportRanked = rankColorCandidates([
    {
      id: 'balanced-logo', engine: 'vtracer', svg: balancedReportSvg,
      preprocessing: { paletteColors: 12 },
      metrics: { fidelity: 98.93, edgeAgreement: 78.13, edgeRecall: 70.35, nodeEstimate: 5407, shapeCount: 132, colorCount: 106 }
    },
    {
      id: 'autotrace-spline-balanced', engine: 'autotrace', svg: autoTraceReportSvg,
      preprocessing: { paletteColors: 12 },
      trace: { params: { colorCount: 12 } },
      metrics: { fidelity: 95.12, edgeAgreement: 53.01, edgeRecall: 39.57, nodeEstimate: 8847, shapeCount: 3318, colorCount: 0 }
    }
  ], 'smart', scoreCandidates);
  assert.equal(reportRanked[0].id, 'balanced-logo', 'Tỏi benchmark must keep curve-safe VTracer instead of detail-losing AutoTrace');
  assert.equal(reportRanked[1].id, 'autotrace-spline-balanced');
  assert.equal(reportRanked[1].metrics.detailLossRisk, true);
  assert.equal(reportRanked[1].rejected, true);
  assert.match(reportRanked[1].rejectedReason, /Edge recall/i);

  const runtime = detectAutoTraceRuntime();
  if (runtime.available) {
    const candidate = await buildAutoTraceColorCandidate({
      inputPath,
      options: { strategy: 'smart', paletteColors: 8 }
    });
    const quality = inspectColorVectorQuality(candidate.svg, {
      requestedColors: 8,
      colorCount: candidate.metrics.colorCount,
      edgeRecall: candidate.metrics.edgeRecall,
      edgeAgreement: candidate.metrics.edgeAgreement
    });
    assert.equal(candidate.engine, 'autotrace');
    assert.equal(candidate.trace.engine, 'autotrace-cli');
    assert.equal(candidate.trace.algorithm, 'autotrace-spline');
    assert.equal(candidate.trace.runtime.available, true);
    assert.equal(candidate.trace.params.colorCount, 8);
    assert.equal(candidate.trace.params.inputFormat, 'png');
    assert.ok(candidate.trace.params.cornerThreshold < 90);
    assert.ok(candidate.trace.params.filterIterations >= 4);
    assert.match(candidate.svg, /viewBox="0 0 760 460"/);
    assert.ok(Number.isFinite(candidate.metrics.fidelity));
    assert.ok(Number.isFinite(candidate.metrics.edgeAgreement));
    assert.ok(candidate.metrics.nodeEstimate > 0);
    assert.ok(quality.curveCommandCount > 0, 'curved flat-color benchmark must contain fitted Bézier commands');
    assert.equal(quality.stairStepRisk, false);
    assert.equal(quality.paletteValidationAvailable, true);
    console.log(`AutoTrace spline OK: fidelity ${candidate.metrics.fidelity}%, curve ${quality.curveFitScore}, ${candidate.metrics.nodeEstimate} nodes, ${quality.colorCount} colors.`);
  } else {
    assert.match(runtime.missingReason, /AutoTrace/);
    console.log(`AutoTrace runtime optional on ${runtime.target}; router fallback test will use curve-safe VTracer.`);
  }
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
