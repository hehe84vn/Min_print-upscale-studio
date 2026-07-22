import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const target = `${process.platform}-${process.arch}`;
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const runtimeRoot = path.join(repositoryRoot, 'vendor', 'autotrace', target);
const manifestPath = path.join(runtimeRoot, 'runtime.json');
const diagnosticsPath = path.join(repositoryRoot, 'runtime-smoke-diagnostics.json');
const executable = path.join(runtimeRoot, 'bin', process.platform === 'win32' ? 'autotrace.exe' : 'autotrace');
let stage = 'initialize';
let manifest = null;
let versionOutput = '';
let traceOutput = '';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.error?.message || output || 'unknown error'}`);
    error.command = command;
    error.args = args;
    error.status = result.status;
    error.output = output;
    throw error;
  }
  return output;
}

function cleanEnvironment(homeDirectory) {
  const env = {
    ...process.env,
    HOME: homeDirectory,
    AUTOTRACE_BINARY: '',
    DYLD_LIBRARY_PATH: '',
    DYLD_FALLBACK_LIBRARY_PATH: '',
    MAGICK_CONFIGURE_PATH: ''
  };
  if (process.platform === 'darwin') env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  return env;
}

function ppmFixture(width = 32, height = 32) {
  const pixels = Buffer.alloc(width * height * 3, 255);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radius = Math.min(width, height) * 0.31;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > radius) continue;
      const offset = (y * width + x) * 3;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii'), pixels]);
}

async function writeDiagnostics(status, extra = {}) {
  await fs.writeFile(diagnosticsPath, `${JSON.stringify({
    status,
    target,
    platform: process.platform,
    arch: process.arch,
    stage,
    runtimeRoot,
    executable,
    manifest,
    versionOutput,
    traceOutput,
    ...extra
  }, null, 2)}\n`, 'utf8');
}

async function main() {
  if (!['darwin', 'win32'].includes(process.platform)) {
    stage = 'skip-unsupported-host';
    await writeDiagnostics('skipped');
    console.log(`AutoTrace bundled runtime smoke skipped on ${target}.`);
    return;
  }

  stage = 'read-manifest';
  assert.equal(await exists(manifestPath), true, `Missing runtime manifest for ${target}`);
  assert.equal(await exists(executable), true, `Missing bundled AutoTrace executable for ${target}`);
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.target, target);
  assert.equal(manifest.bundled, true, `${target} runtime must be bundled`);

  if (process.platform === 'darwin') {
    stage = 'inspect-mach-o-dependencies';
    assert.equal(manifest.relocatable, true, 'macOS runtime must be relocatable');
    assert.ok(manifest.bundledLibraryCount > 0, 'macOS runtime must bundle dylibs');
    const libraryDirectory = path.join(runtimeRoot, 'lib');
    const libraries = (await fs.readdir(libraryDirectory))
      .filter((name) => name.endsWith('.dylib'))
      .map((name) => path.join(libraryDirectory, name));
    assert.equal(libraries.length, manifest.bundledLibraryCount);

    for (const filePath of [executable, ...libraries]) {
      const dependencies = run('otool', ['-L', filePath])
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim().replace(/\s+\(compatibility version.*$/, ''))
        .filter(Boolean);
      const effectiveDependencies = filePath === executable ? dependencies : dependencies.slice(1);
      for (const dependency of effectiveDependencies) {
        const system = dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/');
        assert.ok(system || dependency.startsWith('@loader_path/'), `${path.basename(filePath)} has non-relocatable dependency ${dependency}`);
        assert.doesNotMatch(dependency, /homebrew|cellar|\/usr\/local\//i);
      }
    }
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-bundled-smoke-'));
  try {
    const env = cleanEnvironment(workspace);
    stage = 'version-probe';
    const versionResult = spawnSync(executable, ['-version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      env
    });
    versionOutput = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`.trim();
    assert.equal(Boolean(versionResult.error), false, versionResult.error?.message);
    assert.ok(versionResult.status === 0 || /autotrace/i.test(versionOutput), `AutoTrace version probe failed: ${versionOutput}`);

    stage = 'pnm-to-svg-trace';
    const inputPath = path.join(workspace, 'fixture.ppm');
    const outputPath = path.join(workspace, 'fixture.svg');
    await fs.writeFile(inputPath, ppmFixture());
    traceOutput = run(executable, [
      '-input-format', 'pnm',
      '-output-format', 'svg',
      '-output-file', outputPath,
      '-color-count', '2',
      '-background-color', 'FFFFFF',
      '-despeckle-level', '0',
      inputPath
    ], { env });
    const svg = await fs.readFile(outputPath, 'utf8');
    stage = 'validate-svg-output';
    assert.match(svg, /<svg\b/i);
    assert.match(svg, /<(?:path|polygon|polyline)\b/i);
    await writeDiagnostics('success', { svgBytes: Buffer.byteLength(svg, 'utf8') });
    console.log(`AutoTrace bundled runtime OK on ${target}: ${manifest.bundledLibraryCount ?? 'DLL'} dependencies, clean PATH trace succeeded.`);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  await writeDiagnostics('failure', {
    error: error.message || String(error),
    stack: error.stack || null,
    command: error.command || null,
    args: error.args || null,
    statusCode: error.status ?? null,
    commandOutput: error.output || null
  });
  console.error(`AutoTrace runtime smoke failed at ${stage}: ${error.stack || error}`);
  process.exitCode = 1;
}
