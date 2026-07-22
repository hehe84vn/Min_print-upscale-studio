import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import sharp from 'sharp';

const VERSION = process.env.AUTOTRACE_VERSION || '0.31.10';
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const targetRoot = path.join(repositoryRoot, 'vendor', 'autotrace', 'win32-x64');
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const userAgent = 'Print-Upscale-Studio-AutoTrace-Windows-Runtime';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function requestHeaders(url, accept) {
  const headers = { Accept: accept, 'User-Agent': userAgent };
  if (new URL(url).hostname.toLowerCase() === 'api.github.com') {
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
    // Ignore unreadable bodies.
  }
  return new Error(`${label}: HTTP ${response.status}${detail ? ` · ${detail}` : ''}`);
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: requestHeaders(url, 'application/octet-stream'),
    redirect: 'follow'
  });
  if (!response.ok) throw await responseError(response, 'Download AutoTrace Windows thất bại');
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function selectWindowsAsset(assets = []) {
  return assets.find((item) => /win64.*setup\.exe$/i.test(item.name))
    || assets.find((item) => /win.*64.*\.exe$/i.test(item.name))
    || null;
}

async function discoverFromApi() {
  const url = `https://api.github.com/repos/autotrace/autotrace/releases/tags/${VERSION}`;
  const response = await fetch(url, {
    headers: requestHeaders(url, 'application/vnd.github+json'),
    redirect: 'follow'
  });
  if (!response.ok) throw await responseError(response, `Không đọc được AutoTrace release ${VERSION}`);
  return selectWindowsAsset((await response.json()).assets);
}

async function discoverFromHtml() {
  const pageUrl = `https://github.com/autotrace/autotrace/releases/expanded_assets/${VERSION}`;
  const response = await fetch(pageUrl, {
    headers: requestHeaders(pageUrl, 'text/html'),
    redirect: 'follow'
  });
  if (!response.ok) throw await responseError(response, `Không đọc được asset AutoTrace ${VERSION}`);
  const html = await response.text();
  const href = [...html.matchAll(/href=["']([^"']*\/releases\/download\/[^"']*win64[^"']*setup\.exe)["']/gi)][0]?.[1];
  if (!href) return null;
  const browserDownloadUrl = new URL(href.replaceAll('&amp;', '&'), pageUrl).href;
  return { name: path.basename(new URL(browserDownloadUrl).pathname), browser_download_url: browserDownloadUrl };
}

async function discoverAsset() {
  try {
    const asset = await discoverFromApi();
    if (asset) return asset;
  } catch (error) {
    console.warn(`GitHub API không khả dụng, dùng HTML fallback: ${error.message || error}`);
  }
  return discoverFromHtml();
}

async function findFiles(directory, predicate, output = []) {
  if (!await exists(directory)) return output;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await findFiles(fullPath, predicate, output);
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

async function createPngFixture(outputPath) {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="#fff"/>
      <circle cx="32" cy="32" r="20" fill="#000"/>
    </svg>
  `);
  await sharp(svg).png({ palette: true, colours: 2, dither: 0 }).toFile(outputPath);
}

async function runtimeDirectories(root) {
  const files = await findFiles(root, (filePath) => {
    const name = path.basename(filePath).toLowerCase();
    return name === 'autotrace.exe' || name.endsWith('.dll');
  });
  return [...new Set(files.map((filePath) => path.dirname(filePath)))];
}

function runtimeEnvironment(searchDirectories) {
  return {
    ...process.env,
    PATH: [...searchDirectories, process.env.PATH || ''].filter(Boolean).join(';')
  };
}

async function validateExecutable(executable, installRoot, label) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-win-verify-'));
  try {
    const inputPath = path.join(workspace, 'fixture.png');
    const outputPath = path.join(workspace, 'fixture.svg');
    await createPngFixture(inputPath);
    const searchDirectories = await runtimeDirectories(installRoot);
    const result = spawnSync(executable, [
      '-input-format', 'png',
      '-output-format', 'svg',
      '-output-file', outputPath,
      '-color-count', '2',
      '-background-color', 'FFFFFF',
      '-despeckle-level', '0',
      inputPath
    ], {
      cwd: path.dirname(executable),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: runtimeEnvironment(searchDirectories)
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    let svgBytes = 0;
    let svgValid = false;
    if (!result.error && result.status === 0 && await exists(outputPath)) {
      const svg = await fs.readFile(outputPath, 'utf8');
      svgBytes = Buffer.byteLength(svg, 'utf8');
      svgValid = /<svg\b/i.test(svg) && /<(?:path|polygon|polyline)\b/i.test(svg);
    }
    return {
      label,
      executable,
      relativeExecutable: path.relative(installRoot, executable).replaceAll('\\', '/'),
      status: result.status,
      error: result.error?.message || null,
      output,
      svgBytes,
      svgValid,
      succeeded: !result.error && result.status === 0 && svgValid,
      searchPaths: searchDirectories.map((directory) => path.relative(installRoot, directory).replaceAll('\\', '/') || '.')
    };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function installOfficialRuntime(installer, installRoot) {
  await fs.rm(installRoot, { recursive: true, force: true });
  await fs.mkdir(installRoot, { recursive: true });
  // The upstream Windows package is NSIS. Running it matters: raw 7-Zip
  // extraction skips installer layout/setup logic and produced exit code 127.
  execFileSync(installer, ['/S', `/D=${installRoot}`], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120000
  });
  const executables = await findFiles(installRoot, (filePath) => path.basename(filePath).toLowerCase() === 'autotrace.exe');
  if (!executables.length) throw new Error(`Installer silent hoàn tất nhưng không tạo autotrace.exe trong ${installRoot}.`);
  return executables;
}

async function chooseWorkingExecutable(installRoot, executables) {
  const attempts = [];
  for (const executable of executables) {
    const attempt = await validateExecutable(executable, installRoot, 'installed-runtime');
    attempts.push(attempt);
    if (attempt.succeeded) return { selected: attempt, attempts };
  }
  throw new Error(`Không executable AutoTrace nào trace PNG→SVG thành công sau khi cài silent: ${JSON.stringify(attempts)}`);
}

async function ensureLicense(installRoot) {
  const licenseFiles = await findFiles(installRoot, (filePath) => /(?:copying|license)(?:\.[^.]+)?$/i.test(path.basename(filePath)));
  if (!licenseFiles.length) {
    await download(`https://raw.githubusercontent.com/autotrace/autotrace/${VERSION}/COPYING`, path.join(installRoot, 'COPYING'));
  }
}

async function copyInstalledRuntime(installRoot, selection) {
  await ensureLicense(installRoot);
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  await fs.cp(installRoot, targetRoot, { recursive: true, force: true, dereference: true });

  const relativeExecutable = selection.selected.relativeExecutable;
  const preparedExecutable = path.join(targetRoot, ...relativeExecutable.split('/'));
  if (!await exists(preparedExecutable)) throw new Error(`Runtime đã copy nhưng thiếu ${relativeExecutable}.`);
  const validation = await validateExecutable(preparedExecutable, targetRoot, 'bundled-runtime');
  if (!validation.succeeded) throw new Error(`Runtime bundled không chạy được: ${JSON.stringify(validation)}`);

  const layoutFiles = (await findFiles(targetRoot, () => true))
    .map((filePath) => path.relative(targetRoot, filePath).replaceAll('\\', '/'));
  const searchPaths = validation.searchPaths;
  await fs.writeFile(path.join(targetRoot, 'source-layout.json'), `${JSON.stringify({
    installationMode: 'official-nsis-silent-install',
    selectedSourceExecutable: relativeExecutable,
    candidates: selection.attempts,
    files: layoutFiles
  }, null, 2)}\n`, 'utf8');

  return { preparedExecutable, relativeExecutable, validation, layoutFiles, searchPaths };
}

async function writeManifest(prepared) {
  const manifest = {
    version: VERSION,
    target: 'win32-x64',
    preparedAt: new Date().toISOString(),
    binaryPath: prepared.preparedExecutable,
    bundled: true,
    relocatable: true,
    bundledLibraryCount: prepared.layoutFiles.filter((name) => name.toLowerCase().endsWith('.dll')).length,
    runtimeLayout: {
      executable: prepared.relativeExecutable,
      libraries: 'preserved official installed layout',
      searchPaths: prepared.searchPaths
    },
    validation: prepared.validation,
    license: 'GPL-2.0-or-later',
    upstream: 'https://github.com/autotrace/autotrace'
  };
  await fs.writeFile(path.join(targetRoot, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV, `AUTOTRACE_BINARY=${prepared.preparedExecutable}\n`, 'utf8');
  }
  return manifest;
}

let workspace = null;
try {
  if (process.platform !== 'win32') throw new Error(`Windows runtime phải được chuẩn bị trên Windows, host hiện tại là ${process.platform}.`);
  const asset = await discoverAsset();
  if (!asset) throw new Error(`Release AutoTrace ${VERSION} không có Windows x64 installer.`);
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-win-runtime-'));
  const installer = path.join(workspace, asset.name);
  const installRoot = path.join(workspace, 'installed');
  await download(asset.url || asset.browser_download_url, installer);
  const executables = await installOfficialRuntime(installer, installRoot);
  const selection = await chooseWorkingExecutable(installRoot, executables);
  const prepared = await copyInstalledRuntime(installRoot, selection);
  const manifest = await writeManifest(prepared);
  console.log(`AutoTrace Windows runtime ready: ${JSON.stringify(manifest)}`);
} catch (error) {
  if (strict) throw error;
  console.warn(`AutoTrace Windows runtime không được chuẩn bị: ${error.message || error}`);
} finally {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
}
