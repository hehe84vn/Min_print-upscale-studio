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
const executableName = platform === 'win32' ? 'autotrace.exe' : 'autotrace';
const preparedExecutable = path.join(binDirectory, executableName);
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const userAgent = 'Print-Upscale-Studio-AutoTrace-Runtime';

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

function requestHeaders(url, accept) {
  const headers = {
    Accept: accept,
    'User-Agent': userAgent
  };
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === 'api.github.com') {
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  }
  return headers;
}

async function responseError(response, label) {
  let detail = '';
  try {
    const body = await response.text();
    const parsed = JSON.parse(body);
    detail = parsed.message || body;
  } catch {
    // Ignore unreadable or non-JSON error bodies.
  }
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  const rate = remaining !== null ? ` · rate remaining ${remaining}${reset ? ` · reset ${reset}` : ''}` : '';
  return new Error(`${label}: HTTP ${response.status}${detail ? ` · ${detail}` : ''}${rate}`);
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: requestHeaders(url, 'application/octet-stream'),
    redirect: 'follow'
  });
  if (!response.ok) throw await responseError(response, 'Download AutoTrace thất bại');
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

async function copyLicenseFiles(extracted) {
  const licenseFiles = await findFiles(extracted, (filePath) => /(?:copying|license)(?:\.[^.]+)?$/i.test(path.basename(filePath)));
  const copied = new Set();
  for (const licensePath of licenseFiles) {
    const name = path.basename(licensePath);
    if (copied.has(name.toLowerCase())) continue;
    copied.add(name.toLowerCase());
    await fs.copyFile(licensePath, path.join(targetRoot, name));
  }
  if (!copied.size) {
    await download(
      `https://raw.githubusercontent.com/autotrace/autotrace/${VERSION}/COPYING`,
      path.join(targetRoot, 'COPYING')
    );
  }
}

function selectWindowsAsset(assets = []) {
  return assets.find((item) => /win64.*setup\.exe$/i.test(item.name))
    || assets.find((item) => /win.*64.*\.exe$/i.test(item.name))
    || null;
}

async function discoverWindowsAssetFromApi() {
  const url = `https://api.github.com/repos/autotrace/autotrace/releases/tags/${VERSION}`;
  const response = await fetch(url, {
    headers: requestHeaders(url, 'application/vnd.github+json'),
    redirect: 'follow'
  });
  if (!response.ok) throw await responseError(response, `Không đọc được AutoTrace release ${VERSION}`);
  const release = await response.json();
  return selectWindowsAsset(release.assets);
}

async function discoverWindowsAssetFromHtml() {
  const pageUrl = `https://github.com/autotrace/autotrace/releases/expanded_assets/${VERSION}`;
  const response = await fetch(pageUrl, {
    headers: requestHeaders(pageUrl, 'text/html'),
    redirect: 'follow'
  });
  if (!response.ok) throw await responseError(response, `Không đọc được trang asset AutoTrace ${VERSION}`);
  const html = await response.text();
  const matches = [...html.matchAll(/href=["']([^"']*\/releases\/download\/[^"']*win64[^"']*setup\.exe)["']/gi)];
  const href = matches[0]?.[1];
  if (!href) return null;
  const browserDownloadUrl = new URL(href.replaceAll('&amp;', '&'), pageUrl).href;
  return {
    name: path.basename(new URL(browserDownloadUrl).pathname),
    browser_download_url: browserDownloadUrl
  };
}

async function discoverWindowsAsset() {
  try {
    const asset = await discoverWindowsAssetFromApi();
    if (asset) return asset;
    console.warn(`GitHub Releases API không liệt kê Windows x64 asset cho AutoTrace ${VERSION}; thử HTML fallback.`);
  } catch (error) {
    console.warn(`GitHub Releases API không khả dụng; thử HTML fallback: ${error.message || error}`);
  }
  return discoverWindowsAssetFromHtml();
}

async function prepareWindowsRuntime() {
  if (await exists(preparedExecutable)) return preparedExecutable;

  const asset = await discoverWindowsAsset();
  if (!asset) throw new Error(`Release AutoTrace ${VERSION} không có Windows x64 installer.`);

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-runtime-'));
  const installer = path.join(workspace, asset.name);
  const extracted = path.join(workspace, 'extracted');
  await fs.mkdir(extracted, { recursive: true });
  await download(asset.url || asset.browser_download_url, installer);
  execFileSync('7z', ['x', installer, `-o${extracted}`, '-y'], { stdio: 'inherit', windowsHide: true });
  const executables = await findFiles(extracted, (filePath) => path.basename(filePath).toLowerCase() === 'autotrace.exe');
  if (!executables.length) throw new Error('Không tìm thấy autotrace.exe sau khi giải nén installer.');
  const executable = executables[0];
  const dlls = await findFiles(extracted, (filePath) => filePath.toLowerCase().endsWith('.dll'));
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(binDirectory, { recursive: true });
  await fs.copyFile(executable, preparedExecutable);
  const copied = new Set();
  for (const dll of dlls) {
    const name = path.basename(dll);
    if (copied.has(name.toLowerCase())) continue;
    copied.add(name.toLowerCase());
    await fs.copyFile(dll, path.join(binDirectory, name));
  }
  await copyLicenseFiles(extracted);
  await fs.rm(workspace, { recursive: true, force: true });
  return preparedExecutable;
}

async function prepareSystemRuntime() {
  const explicit = process.env.AUTOTRACE_BINARY;
  const binary = explicit && await exists(explicit) ? explicit : commandPath('autotrace');
  await fs.mkdir(targetRoot, { recursive: true });
  if (!binary) return null;
  // Homebrew binaries have dynamic dependencies. V2.9.2 records the verified
  // system runtime instead of copying a non-portable executable without dylibs.
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
