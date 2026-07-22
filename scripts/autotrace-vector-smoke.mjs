import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import runtimeModule from '../src/main/services/autotraceRuntimeService.js';
import autoTraceModule from '../src/main/services/autotraceVectorEngine.js';

const { detectAutoTraceRuntime } = runtimeModule;
const { buildAutoTraceColorCandidate, normalizeSvgCanvas, prepareAutoTracePpm } = autoTraceModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-vector-smoke-'));
const inputPath = path.join(workspace, 'flat-color-source.png');
const ppmPath = path.join(workspace, 'flat-color-source.ppm');

try {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    const runtime = detectAutoTraceRuntime({ platform, arch, probe: false });
    assert.equal(runtime.supportedTarget, true, `${platform}-${arch} must be recognized`);
    assert.equal(runtime.runtimeType, 'external-executable');
    assert.equal(runtime.binaryRequired, true);
  }
  assert.equal(detectAutoTraceRuntime({ platform: 'linux', arch: 'arm64', probe: false }).supportedTarget, false);

  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="760" height="460" viewBox="0 0 760 460">
      <rect width="760" height="460" fill="#fff"/>
      <ellipse cx="250" cy="230" rx="190" ry="145" fill="#173f5f"/>
      <ellipse cx="250" cy="230" rx="112" ry="72" fill="#f6d55c"/>
      <path d="M410 90C590 80 690 180 650 310C620 405 485 410 405 330C510 345 575 300 575 230C575 165 515 125 410 145Z" fill="#ed553b"/>
      <circle cx="610" cy="105" r="38" fill="#3caea3"/>
    </svg>
  `);
  await sharp(artwork).png().toFile(inputPath);
  const source = await prepareAutoTracePpm(inputPath, ppmPath, { paletteColors: 8 });
  const ppm = await fs.readFile(ppmPath);
  assert.match(ppm.subarray(0, 32).toString('ascii'), /^P6\n760 460\n255\n/);
  assert.equal(source.width, 760);
  assert.equal(source.height, 460);
  assert.equal(source.inputFormat, 'ppm-p6');

  const normalized = normalizeSvgCanvas('<svg width="10" height="20" viewBox="0 0 10 20"><path d="M0 0Z"/></svg>', source);
  assert.match(normalized, /width="760"/);
  assert.match(normalized, /height="460"/);
  assert.match(normalized, /viewBox="0 0 760 460"/);

  const runtime = detectAutoTraceRuntime();
  if (runtime.available) {
    const candidate = await buildAutoTraceColorCandidate({
      inputPath,
      options: { strategy: 'smart', paletteColors: 8 }
    });
    assert.equal(candidate.engine, 'autotrace');
    assert.equal(candidate.trace.engine, 'autotrace-cli');
    assert.equal(candidate.trace.runtime.available, true);
    assert.equal(candidate.trace.params.colorCount, 8);
    assert.match(candidate.svg, /viewBox="0 0 760 460"/);
    assert.ok(Number.isFinite(candidate.metrics.fidelity));
    assert.ok(Number.isFinite(candidate.metrics.edgeAgreement));
    assert.ok(candidate.metrics.nodeEstimate > 0);
    console.log(`AutoTrace color OK: fidelity ${candidate.metrics.fidelity}%, edge ${candidate.metrics.edgeAgreement}%, ${candidate.metrics.nodeEstimate} nodes.`);
  } else {
    assert.match(runtime.missingReason, /AutoTrace/);
    console.log(`AutoTrace runtime optional on ${runtime.target}; router fallback test will use VTracer.`);
  }
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
