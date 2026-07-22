'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64'
]);

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

function runProbe(binaryPath, args, timeout) {
  const result = spawnSync(binaryPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout
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

function probeAutoTrace(binaryPath, { timeout = 5000 } = {}) {
  const isPath = path.isAbsolute(binaryPath) || binaryPath.includes(path.sep) || binaryPath.includes('/');
  if (isPath && !fs.existsSync(binaryPath)) {
    return { available: false, binaryPath, error: 'file-not-found', attempts: [] };
  }

  const attempts = [
    runProbe(binaryPath, ['-version'], timeout),
    runProbe(binaryPath, ['--version'], timeout),
    runProbe(binaryPath, ['-list-output-formats'], timeout)
  ];
  const selected = attempts.find((attempt) => attempt.succeeded)
    || attempts.find((attempt) => /autotrace|\bsvg\b|\beps\b/i.test(attempt.output));
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
      const result = probe ? probeAutoTrace(candidate) : {
        available: path.isAbsolute(candidate) ? fs.existsSync(candidate) : true,
        binaryPath: candidate,
        version: null,
        output: '',
        status: null,
        error: null,
        probeArgs: null,
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
  SUPPORTED_TARGETS,
  currentTarget,
  detectAutoTraceRuntime,
  executableName,
  packagedCandidates,
  probeAutoTrace,
  requireAutoTraceRuntime,
  runProbe
};
