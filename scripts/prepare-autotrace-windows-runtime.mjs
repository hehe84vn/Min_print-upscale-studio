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
const binDirectory = path.join(targetRoot, 'bin');
const preparedExecutable = path.join(binDirectory, 'autotrace.exe');
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

function scoreExecutable(filePath, size) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  let score = Math.min(50, Math.floor(size / 100000));
  if (normalized.endsWith('/bin/autotrace.exe')) score += 1000;
  if (normalized.includes('/$pluginsdir/') || normalized.includes('/plugin/')) score -= 500;
  if (normalized.includes('uninstall')) score -= 1000;
  return score;
}

async function chooseExecutable(extracted) {
  const candidates = await findFiles(extracted, (filePath) => path.basename(filePath).toLowerCase() === 'autotrace.exe');
  const scored = [];
  for (const filePath of candidates) {
    const stat = await fs.stat(filePath);
    scored.push({ filePath, size: stat.size, score: scoreExecutable(filePath, stat.size) });
  }
  scored.sort((left, right) => right.score - left.score || right.size - left.size);
  if (!scored.length) throw new Error('Không tìm thấy autotrace.exe trong installer Windows.');
  return { selected: scored[0], candidates: scored };
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

async function copyOfficialLayout(extracted, selection) {
  const executableDirectory = path.dirname(selection.selected.filePath);
  const hasBinLayout = path.basename(executableDirectory).toLowerCase() === 'bin';
  const installRoot = hasBinLayout ? path.dirname(executableDirectory) : executableDirectory;

  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  await fs.cp(installRoot, targetRoot, { recursive: true, force: true, dereference: true });

  if (!await exists(preparedExecutable)) {
    await fs.mkdir(binDirectory, { recursive: true });
    await fs.cp(executableDirectory, binDirectory, { recursive: true, force: true, dereference: true });
  }
  if (!await exists(preparedExecutable)) throw new Error('Layout đã copy nhưng thiếu bin/autotrace.exe.');

  const licenseFiles = await findFiles(installRoot, (filePath) => /(?:copying|license)(?:\.[^.]+)?$/i.test(path.basename(filePath)));
  if (!licenseFiles.length) {
    await download(`https://raw.githubusercontent.com/autotrace/autotrace/${VERSION}/COPYING`, path.join(targetRoot, 'COPYING'));
  }

  const layoutFiles = (await findFiles(targetRoot, () => true)).map((filePath) => path.relative(targetRoot, filePath).replaceAll('\\', '/'));
  await fs.writeFile(path.join(targetRoot, 'source-layout.json'), `${JSON.stringify({
    selectedSourceExecutable: path.relative(extracted, selection.selected.filePath).replaceAll('\\', '/'),
    selectedSize: selection.selected.size,
    selectedScore: selection.selected.score,
    installRoot: path.relative(extracted, installRoot).replaceAll('\\', '/'),
    candidates: selection.candidates.map((candidate) => ({
      path: path.relative(extracted, candidate.filePath).replaceAll('\\', '/'),
      size: candidate.size,
      score: candidate.score
    })),
    files: layoutFiles
  }, null, 2)}\n`, 'utf8');
  return layoutFiles;
}

async function validatePreparedRuntime(layoutFiles) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-win-verify-'));
  try {
    const inputPath = path.join(workspace, 'fixture.png');
    const outputPath = path.join(workspace, 'fixture.svg');
    await createPngFixture(inputPath);
    const result = spawnSync(preparedExecutable, [
      '-input-format', 'png',
      '-output-format', 'svg',
      '-output-file', outputPath,
      '-color-count', '2',
      '-background-color', 'FFFFFF',
      '-despeckle-level', '0',
      inputPath
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, PATH: `${binDirectory};${process.env.PATH || ''}` }
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (result.error || result.status !== 0) {
      throw new Error(`AutoTrace Windows runtime không khởi động (${result.status}): ${result.error?.message || output || 'không có output'} · files: ${layoutFiles.slice(0, 80).join(', ')}`);
    }
    const svg = await fs.readFile(outputPath, 'utf8');
    if (!/<svg\b/i.test(svg)) throw new Error('AutoTrace Windows runtime không tạo SVG.');
    return { status: result.status, output, svgBytes: Buffer.byteLength(svg, 'utf8') };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function writeManifest(validation, layoutFiles) {
  const manifest = {
    version: VERSION,
    target: 'win32-x64',
    preparedAt: new Date().toISOString(),
    binaryPath: preparedExecutable,
    bundled: true,
    relocatable: null,
    bundledLibraryCount: layoutFiles.filter((name) => name.toLowerCase().endsWith('.dll')).length,
    runtimeLayout: { executable: 'bin/autotrace.exe', libraries: 'preserved official installer layout' },
    validation,
    license: 'GPL-2.0-or-later',
    upstream: 'https://github.com/autotrace/autotrace'
  };
  await fs.writeFile(path.join(targetRoot, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (process.env.GITHUB_ENV) await fs.appendFile(process.env.GITHUB_ENV, `AUTOTRACE_BINARY=${preparedExecutable}\n`, 'utf8');
  return manifest;
}

let workspace = null;
try {
  const asset = await discoverAsset();
  if (!asset) throw new Error(`Release AutoTrace ${VERSION} không có Windows x64 installer.`);
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autotrace-win-runtime-'));
  const installer = path.join(workspace, asset.name);
  const extracted = path.join(workspace, 'extracted');
  await fs.mkdir(extracted, { recursive: true });
  await download(asset.url || asset.browser_download_url, installer);
  execFileSync('7z', ['x', installer, `-o${extracted}`, '-y'], { stdio: 'inherit', windowsHide: true });
  const selection = await chooseExecutable(extracted);
  const layoutFiles = await copyOfficialLayout(extracted, selection);
  const validation = await validatePreparedRuntime(layoutFiles);
  const manifest = await writeManifest(validation, layoutFiles);
  console.log(`AutoTrace Windows runtime ready: ${JSON.stringify(manifest)}`);
} catch (error) {
  if (strict) throw error;
  console.warn(`AutoTrace Windows runtime không được chuẩn bị: ${error.message || error}`);
} finally {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
}
