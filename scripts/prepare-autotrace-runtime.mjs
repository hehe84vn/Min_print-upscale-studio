import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const VERSION = process.env.AUTOTRACE_VERSION || '0.31.10';
const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const platform = valueAfter('--platform', process.platform);
const arch = valueAfter('--arch', process.arch);
const strict = args.includes('--strict');
const target = `${platform}-${arch}`;
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const targetRoot = path.join(repositoryRoot, 'vendor', 'autotrace', target);
const binDirectory = path.join(targetRoot, 'bin');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function commandPath(command) {
  try {
    const locator = platform === 'win32' ? 'where.exe' : 'which';
    return String(execFileSync(locator, [command], { encoding: 'utf8', windowsHide: true }))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
  } catch {
    return null;
  }
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'Print-Upscale-Studio-AutoTrace-Runtime'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Download AutoTrace thất bại: HTTP ${response.status}`);
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function findFiles(directory, predicate, output = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await findFiles(fullPath, predicate, output);
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

async function prepareWindowsRuntime() {
  const releaseResponse = await fetch(`https://api.github.com/repos/autotrace/autotrace/releases/tags/${VERSION}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Print-Upscale-Studio-AutoTrace-Runtime' }
  });
  if (!releaseResponse.ok) throw new Error(`Không đọc được AutoTrace release ${VERSION}: HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json();
  const asset = release.assets?.find((item) => /win64.*setup\.exe$/i.test(item.name))
    || release.assets?.find((item) => /win.*64.*\.exe$/i.test(item.name));
  if (!asset) throw new Error(`Release AutoTrace ${VERSION} không có Windows x64 installer.`);

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-runtime-'));
  const installer = path.join(workspace, asset.name);
  const extracted = path.join(workspace, 'extracted');
  await fs.mkdir(extracted, { recursive: true });
  await download(asset.browser_download_url, installer);
  execFileSync('7z', ['x', installer, `-o${extracted}`, '-y'], { stdio: 'inherit', windowsHide: true });
  const executables = await findFiles(extracted, (filePath) => path.basename(filePath).toLowerCase() === 'autotrace.exe');
  if (!executables.length) throw new Error('Không tìm thấy autotrace.exe sau khi giải nén installer.');
  const executable = executables[0];
  const dlls = await findFiles(extracted, (filePath) => filePath.toLowerCase().endsWith('.dll'));
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(binDirectory, { recursive: true });
  await fs.copyFile(executable, path.join(binDirectory, 'autotrace.exe'));
  const copied = new Set();
  for (const dll of dlls) {
    const name = path.basename(dll);
    if (copied.has(name.toLowerCase())) continue;
    copied.add(name.toLowerCase());
    await fs.copyFile(dll, path.join(binDirectory, name));
  }
  await fs.rm(workspace, { recursive: true, force: true });
  return path.join(binDirectory, 'autotrace.exe');
}

async function prepareSystemRuntime() {
  const explicit = process.env.AUTOTRACE_BINARY;
  const binary = explicit && await exists(explicit) ? explicit : commandPath('autotrace');
  await fs.mkdir(targetRoot, { recursive: true });
  if (!binary) return null;
  // macOS Homebrew binaries have dynamic dependencies. V2.9.2 records the
  // verified system runtime instead of copying an incomplete executable.
  return binary;
}

async function writeManifest(binaryPath) {
  await fs.mkdir(targetRoot, { recursive: true });
  const manifest = {
    version: VERSION,
    target,
    preparedAt: new Date().toISOString(),
    binaryPath: binaryPath || null,
    bundled: platform === 'win32' && Boolean(binaryPath),
    license: 'GPL-2.0-or-later',
    upstream: 'https://github.com/autotrace/autotrace'
  };
  await fs.writeFile(path.join(targetRoot, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (binaryPath && process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV, `AUTOTRACE_BINARY=${binaryPath}\n`, 'utf8');
  }
  return manifest;
}

let binaryPath = null;
try {
  if (platform === 'win32' && arch === 'x64') binaryPath = await prepareWindowsRuntime();
  else binaryPath = await prepareSystemRuntime();
  const manifest = await writeManifest(binaryPath);
  if (!binaryPath && strict) throw new Error(`AutoTrace runtime thiếu cho ${target}.`);
  console.log(`AutoTrace runtime ${binaryPath ? 'ready' : 'optional/missing'}: ${JSON.stringify(manifest)}`);
} catch (error) {
  await writeManifest(null);
  if (strict) throw error;
  console.warn(`AutoTrace runtime không được chuẩn bị; app sẽ fallback sang VTracer: ${error.message || error}`);
}
