'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64'
]);

// 32×32 white PNG with a black circle. Kept inline so runtime detection does not
// depend on Sharp or any external executable.
const FUNCTIONAL_PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAdUlEQVR42u2VzQ7AIAiDpdn7vzK770c6GsJhcDRfWzUK5u6rsrCKawL6Aw6SM7PLCvn8LOTu1p9ioLgzABQxg0F0D2Ho7ntJxz9IbH8jnFbxz4D0EH0UNl1R4hBvEqT7MAlD6fUMBkXMAMZOvrqROT95AqI6AV+HMzMtWjRDAAAAAElFTkSuQmCC',
  'base64'
);

function currentTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'autotrace.exe' : 'autotrace';
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function packagedCandidates(platform, arch) {
  const executable = executableName(platform);
  const target = currentTarget(platform, arch);
  const resourcesPath = process.resourcesPath || null;
  const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
  return unique([
    process.env.AUTOTRACE_BINARY,
    resourcesPath && path.join(resourcesPath, 'autotrace-runtime', 'bin', executable),
    resourcesPath && path.join(resourcesPath, 'autotrace-runtime', executable),
    path.join(repositoryRoot, 'vendor', 'autotrace', target, 'bin', executable),
    path.join(repositoryRoot, 'vendor', 'autotrace', target, executable),
    platform === 'darwin' && '/opt/homebrew/bin/autotrace',
    platform === 'darwin' && '/usr/local/bin/autotrace',
    platform === 'win32' && process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'AutoTrace', executable),
    platform === 'win32' && process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'AutoTrace', executable),
    executable
  ]);
}

function runProbe(binaryPath, args, timeout, options = {}) {
  const result = spawnSync(binaryPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    ...options
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return {
    args,
    output,
    status: result.status,
    signal: result.signal || null,
    error: result.error?.message || null,
    succeeded: !result.error && result.status === 0
  };
}

function runFunctionalProbe(binaryPath, timeout) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'autotrace-functional-probe-'));
  const inputPath = path.join(workspace, 'probe.png');
  const outputPath = path.join(workspace, 'probe.svg');
  try {
    fs.writeFileSync(inputPath, FUNCTIONAL_PROBE_PNG);
    const attempt = runProbe(binaryPath, [
      '-input-format', 'png',
      '-output-format', 'svg',
      '-output-file', outputPath,
      '-color-count', '2',
      '-background-color', 'FFFFFF',
      '-despeckle-level', '0',
      inputPath
    ], timeout);
    let svgValid = false;
    let svgBytes = 0;
    if (!attempt.error && attempt.status === 0 && fs.existsSync(outputPath)) {
      const svg = fs.readFileSync(outputPath, 'utf8');
      svgBytes = Buffer.byteLength(svg, 'utf8');
      svgValid = /<svg\b/i.test(svg) && /<(?:path|polygon|polyline)\b/i.test(svg);
    }
    return {
      ...attempt,
      functional: true,
      svgValid,
      svgBytes,
      succeeded: attempt.succeeded && svgValid
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function probeAutoTrace(binaryPath, { timeout = 5000, functionalFallback = process.platform === 'win32' } = {}) {
  const isPath = path.isAbsolute(binaryPath) || binaryPath.includes(path.sep) || binaryPath.includes('/');
  if (isPath && !fs.existsSync(binaryPath)) {
    return { available: false, binaryPath, error: 'file-not-found', attempts: [] };
  }

  const attempts = [
    runProbe(binaryPath, ['-version'], timeout),
    runProbe(binaryPath, ['--version'], timeout),
    runProbe(binaryPath, ['-list-output-formats'], timeout)
  ];
  let selected = attempts.find((attempt) => attempt.succeeded)
    || attempts.find((attempt) => /autotrace|\bsvg\b|\beps\b/i.test(attempt.output));

  // Some official Windows builds return 127 for informational switches even
  // though tracing works. A real PNG→SVG conversion is the source of truth.
  if (!selected && functionalFallback) {
    const functionalAttempt = runFunctionalProbe(binaryPath, Math.max(timeout, 15000));
    attempts.push(functionalAttempt);
    if (functionalAttempt.succeeded) selected = functionalAttempt;
  }

  const combinedOutput = attempts.map((attempt) => attempt.output).filter(Boolean).join('\n');
  const versionMatch = combinedOutput.match(/(?:AutoTrace\s*(?:version)?\s*)?(\d+\.\d+(?:\.\d+)?)/i);
  const available = Boolean(selected && !selected.error);

  return {
    available,
    binaryPath,
    version: versionMatch?.[1] || null,
    output: selected?.output || combinedOutput,
    status: selected?.status ?? attempts.at(-1)?.status ?? null,
    error: available ? null : attempts.find((attempt) => attempt.error)?.error || null,
    probeArgs: selected?.args || null,
    probeType: selected?.functional ? 'functional-trace' : selected ? 'informational-command' : null,
    attempts
  };
}

function detectAutoTraceRuntime({
  platform = process.platform,
  arch = process.arch,
  binaryOverride = null,
  probe = true
} = {}) {
  const target = currentTarget(platform, arch);
  const supportedTarget = SUPPORTED_TARGETS.has(target);
  const candidates = unique([
    binaryOverride,
    ...packagedCandidates(platform, arch)
  ]);

  let selected = null;
  if (supportedTarget) {
    for (const candidate of candidates) {
      const result = probe ? probeAutoTrace(candidate, {
        functionalFallback: platform === 'win32'
      }) : {
        available: path.isAbsolute(candidate) ? fs.existsSync(candidate) : true,
        binaryPath: candidate,
        version: null,
        output: '',
        status: null,
        error: null,
        probeArgs: null,
        probeType: null,
        attempts: []
      };
      if (result.available) {
        selected = result;
        break;
      }
    }
  }

  const packaged = Boolean(selected?.binaryPath && process.resourcesPath
    && path.resolve(selected.binaryPath).startsWith(path.resolve(process.resourcesPath)));
  const repositoryRuntime = Boolean(selected?.binaryPath
    && selected.binaryPath.includes(`${path.sep}vendor${path.sep}autotrace${path.sep}`));

  return {
    id: 'autotrace-cli',
    algorithm: 'autotrace',
    runtimeType: 'external-executable',
    target,
    platform,
    arch,
    supportedTarget,
    distributionTarget: supportedTarget,
    available: Boolean(selected),
    binaryRequired: true,
    binaryPath: selected?.binaryPath || null,
    source: packaged ? 'packaged-resources' : repositoryRuntime ? 'vendor-runtime' : selected ? 'system-path' : null,
    version: selected?.version || null,
    probeArgs: selected?.probeArgs || null,
    probeType: selected?.probeType || null,
    packageLicense: 'GPL-2.0-or-later',
    libraryLicense: 'LGPL-2.1-or-later',
    upstream: 'https://github.com/autotrace/autotrace',
    distributionNotice: 'AutoTrace executable is GPL-2.0-or-later. Current use is personal/internal; reassess obligations before external distribution.',
    missingReason: selected
      ? null
      : !supportedTarget
        ? `AutoTrace runtime target không được hỗ trợ: ${target}.`
        : `Không tìm thấy AutoTrace executable hoạt động cho ${target}. Đã kiểm tra packaged resources, vendor runtime và PATH.`
  };
}

function requireAutoTraceRuntime(options = {}) {
  const runtime = detectAutoTraceRuntime(options);
  if (!runtime.available) {
    const error = new Error(runtime.missingReason || 'AutoTrace runtime không khả dụng.');
    error.code = runtime.supportedTarget ? 'AUTOTRACE_RUNTIME_MISSING' : 'AUTOTRACE_RUNTIME_UNSUPPORTED';
    error.runtime = runtime;
    throw error;
  }
  return runtime;
}

module.exports = {
  FUNCTIONAL_PROBE_PNG,
  SUPPORTED_TARGETS,
  currentTarget,
  detectAutoTraceRuntime,
  executableName,
  packagedCandidates,
  probeAutoTrace,
  requireAutoTraceRuntime,
  runFunctionalProbe,
  runProbe
};