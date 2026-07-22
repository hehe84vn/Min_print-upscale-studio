'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64'
]);

function currentTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function readPackageMetadata(packageJsonPath) {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function detectPotraceRuntime({ platform = process.platform, arch = process.arch } = {}) {
  const target = currentTarget(platform, arch);
  const supportedTarget = SUPPORTED_TARGETS.has(target);
  let modulePath = null;
  let packageJsonPath = null;
  let metadata = null;
  let resolutionError = null;

  try {
    modulePath = require.resolve('potrace');
    packageJsonPath = require.resolve('potrace/package.json');
    metadata = readPackageMetadata(packageJsonPath);
  } catch (error) {
    resolutionError = error;
  }

  const available = supportedTarget && Boolean(modulePath);
  return {
    id: 'potrace-js',
    algorithm: 'potrace',
    runtimeType: 'node-package',
    target,
    platform,
    arch,
    supportedTarget,
    available,
    binaryRequired: false,
    modulePath,
    packageRoot: packageJsonPath ? path.dirname(packageJsonPath) : null,
    packageName: metadata?.name || 'potrace',
    packageVersion: metadata?.version || null,
    packageLicense: metadata?.license || 'GPL-2.0',
    distributionNotice: 'GPL-2.0 copyleft dependency. Do not describe an MIT-only commercial bundle as license-clean; review distribution obligations or isolate/replace this runtime before release.',
    missingReason: available
      ? null
      : !supportedTarget
        ? `Potrace runtime target không được hỗ trợ: ${target}.`
        : `Không tìm thấy dependency potrace trong packaged runtime${resolutionError?.message ? `: ${resolutionError.message}` : '.'}`
  };
}

function requirePotraceRuntime(options = {}) {
  const runtime = detectPotraceRuntime(options);
  if (!runtime.available) {
    const error = new Error(runtime.missingReason || 'Potrace runtime không khả dụng.');
    error.code = runtime.supportedTarget ? 'POTRACE_RUNTIME_MISSING' : 'POTRACE_RUNTIME_UNSUPPORTED';
    error.runtime = runtime;
    throw error;
  }
  return runtime;
}

module.exports = {
  SUPPORTED_TARGETS,
  currentTarget,
  detectPotraceRuntime,
  requirePotraceRuntime
};
