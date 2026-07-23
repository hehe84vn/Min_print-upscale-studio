import crypto from 'node:crypto';
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
const libDirectory = path.join(targetRoot, 'lib');
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

function run(command, commandArgs, options = {}) {
  return String(execFileSync(command, commandArgs, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...options
  }) || '');
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
  if (!await exists(directory)) return output;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await findFiles(fullPath, predicate, output);
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

async function ensureAutoTraceLicense() {
  await fs.mkdir(targetRoot, { recursive: true });
  const destination = path.join(targetRoot, 'COPYING');
  if (!await exists(destination)) {
    await download(`https://raw.githubusercontent.com/autotrace/autotrace/${VERSION}/COPYING`, destination);
  }
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
  if (!copied.size) await ensureAutoTraceLicense();
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

function isSystemMacDependency(installName) {
  return installName.startsWith('/usr/lib/')
    || installName.startsWith('/System/Library/')
    || installName === '/usr/lib/libSystem.B.dylib';
}

function parseMacDependencies(filePath, { dylib = false } = {}) {
  const lines = run('otool', ['-L', filePath])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().replace(/\s+\(compatibility version.*$/, ''))
    .filter(Boolean);
  return dylib ? lines.slice(1) : lines;
}

function parseMacRpaths(filePath) {
  const lines = run('otool', ['-l', filePath]).split(/\r?\n/);
  const rpaths = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== 'cmd LC_RPATH') continue;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 7); cursor += 1) {
      const match = lines[cursor].trim().match(/^path\s+(.+?)\s+\(offset\s+\d+\)$/);
      if (match) {
        rpaths.push(match[1]);
        break;
      }
    }
  }
  return rpaths;
}

function expandMacToken(value, loaderPath, executableDirectory) {
  if (value.startsWith('@loader_path')) return path.resolve(path.dirname(loaderPath), value.slice('@loader_path'.length).replace(/^\//, ''));
  if (value.startsWith('@executable_path')) return path.resolve(executableDirectory, value.slice('@executable_path'.length).replace(/^\//, ''));
  return value;
}

async function resolveMacDependency(installName, loaderPath, executableDirectory) {
  if (path.isAbsolute(installName)) return await exists(installName) ? fs.realpath(installName) : null;
  if (installName.startsWith('@loader_path') || installName.startsWith('@executable_path')) {
    const expanded = expandMacToken(installName, loaderPath, executableDirectory);
    return await exists(expanded) ? fs.realpath(expanded) : null;
  }
  if (installName.startsWith('@rpath/')) {
    const suffix = installName.slice('@rpath/'.length);
    for (const rawRpath of parseMacRpaths(loaderPath)) {
      const expandedRoot = expandMacToken(rawRpath, loaderPath, executableDirectory);
      const candidate = path.resolve(expandedRoot, suffix);
      if (await exists(candidate)) return fs.realpath(candidate);
    }
  }
  return null;
}

function uniqueLibraryName(sourcePath, usedNames) {
  const original = path.basename(sourcePath);
  const existing = usedNames.get(original.toLowerCase());
  if (!existing || existing === sourcePath) {
    usedNames.set(original.toLowerCase(), sourcePath);
    return original;
  }
  const extension = path.extname(original);
  const stem = original.slice(0, original.length - extension.length);
  const suffix = crypto.createHash('sha256').update(sourcePath).digest('hex').slice(0, 8);
  const uniqueName = `${stem}-${suffix}${extension}`;
  usedNames.set(uniqueName.toLowerCase(), sourcePath);
  return uniqueName;
}

async function collectMacRuntimeGraph(sourceExecutable) {
  const executableSource = await fs.realpath(sourceExecutable);
  const executableDirectory = path.dirname(executableSource);
  const queue = [{ sourcePath: executableSource, executable: true }];
  const records = new Map();

  while (queue.length) {
    const current = queue.shift();
    if (records.has(current.sourcePath)) continue;
    const dylib = !current.executable;
    const dependencies = [];
    for (const installName of parseMacDependencies(current.sourcePath, { dylib })) {
      if (isSystemMacDependency(installName)) {
        dependencies.push({ installName, system: true, sourcePath: null });
        continue;
      }
      const resolved = await resolveMacDependency(installName, current.sourcePath, executableDirectory);
      if (!resolved) throw new Error(`Không resolve được dylib ${installName} từ ${current.sourcePath}.`);
      dependencies.push({ installName, system: false, sourcePath: resolved });
      if (!records.has(resolved)) queue.push({ sourcePath: resolved, executable: false });
    }
    records.set(current.sourcePath, {
      sourcePath: current.sourcePath,
      executable: current.executable,
      dependencies
    });
  }

  return { executableSource, records };
}

async function validateRelocatableMacRuntime(binaryPath, libraryPaths) {
  const allFiles = [binaryPath, ...libraryPaths];
  for (const filePath of allFiles) {
    const dylib = filePath !== binaryPath;
    const dependencies = parseMacDependencies(filePath, { dylib });
    for (const installName of dependencies) {
      if (isSystemMacDependency(installName)) continue;
      if (!installName.startsWith('@loader_path/')) {
        throw new Error(`Runtime macOS chưa relocatable: ${path.basename(filePath)} → ${installName}`);
      }
      if (/homebrew|cellar|\/usr\/local\//i.test(installName)) {
        throw new Error(`Runtime macOS còn phụ thuộc Homebrew: ${path.basename(filePath)} → ${installName}`);
      }
    }
  }

  const cleanEnvironment = {
    ...process.env,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    DYLD_LIBRARY_PATH: '',
    DYLD_FALLBACK_LIBRARY_PATH: '',
    AUTOTRACE_BINARY: ''
  };
  const output = run(binaryPath, ['-version'], { env: cleanEnvironment });
  if (!/autotrace|\d+\.\d+/i.test(output)) throw new Error('AutoTrace bundled macOS không phản hồi version trong môi trường sạch.');
}

async function prepareMacRuntime() {
  if (await exists(preparedExecutable)) return preparedExecutable;
  if (process.platform !== 'darwin') throw new Error(`Không thể bundle runtime macOS trên host ${process.platform}.`);

  const explicit = process.env.AUTOTRACE_BINARY;
  const detected = explicit && await exists(explicit) ? explicit : commandPath('autotrace');
  if (!detected) return null;

  const graph = await collectMacRuntimeGraph(detected);
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(binDirectory, { recursive: true });
  await fs.mkdir(libDirectory, { recursive: true });

  const usedNames = new Map();
  const destinationBySource = new Map();
  destinationBySource.set(graph.executableSource, preparedExecutable);
  for (const record of graph.records.values()) {
    if (record.executable) continue;
    destinationBySource.set(record.sourcePath, path.join(libDirectory, uniqueLibraryName(record.sourcePath, usedNames)));
  }

  await fs.copyFile(graph.executableSource, preparedExecutable);
  await fs.chmod(preparedExecutable, 0o755);
  for (const record of graph.records.values()) {
    if (record.executable) continue;
    const destination = destinationBySource.get(record.sourcePath);
    await fs.copyFile(record.sourcePath, destination);
    await fs.chmod(destination, 0o755);
  }

  for (const record of graph.records.values()) {
    const destination = destinationBySource.get(record.sourcePath);
    for (const dependency of record.dependencies) {
      if (dependency.system) continue;
      const dependencyDestination = destinationBySource.get(dependency.sourcePath);
      const relocated = record.executable
        ? `@loader_path/../lib/${path.basename(dependencyDestination)}`
        : `@loader_path/${path.basename(dependencyDestination)}`;
      run('install_name_tool', ['-change', dependency.installName, relocated, destination]);
    }
    if (!record.executable) run('install_name_tool', ['-id', `@loader_path/${path.basename(destination)}`, destination]);
  }

  const libraryPaths = [...graph.records.values()]
    .filter((record) => !record.executable)
    .map((record) => destinationBySource.get(record.sourcePath));
  for (const libraryPath of libraryPaths) run('codesign', ['--force', '--sign', '-', '--timestamp=none', libraryPath]);
  run('codesign', ['--force', '--sign', '-', '--timestamp=none', preparedExecutable]);

  await validateRelocatableMacRuntime(preparedExecutable, libraryPaths);
  await ensureAutoTraceLicense();
  await fs.writeFile(path.join(targetRoot, 'runtime-libraries.json'), `${JSON.stringify({
    target,
    executable: 'bin/autotrace',
    libraries: libraryPaths.map((filePath) => `lib/${path.basename(filePath)}`),
    libraryCount: libraryPaths.length,
    relocation: '@loader_path',
    source: 'Homebrew bottle copied and relocated during build'
  }, null, 2)}\n`, 'utf8');
  return preparedExecutable;
}

async function prepareSystemRuntime() {
  const explicit = process.env.AUTOTRACE_BINARY;
  const binary = explicit && await exists(explicit) ? explicit : commandPath('autotrace');
  await fs.mkdir(targetRoot, { recursive: true });
  return binary || null;
}

async function countBundledLibraries() {
  const files = await findFiles(libDirectory, (filePath) => filePath.toLowerCase().endsWith('.dylib'));
  return files.length;
}

async function writeManifest(binaryPath) {
  await fs.mkdir(targetRoot, { recursive: true });
  const resolvedBinary = binaryPath ? path.resolve(binaryPath) : null;
  const bundled = Boolean(resolvedBinary && resolvedBinary.startsWith(path.resolve(targetRoot) + path.sep));
  const manifest = {
    version: VERSION,
    target,
    preparedAt: new Date().toISOString(),
    binaryPath: binaryPath || null,
    bundled,
    relocatable: platform === 'darwin' ? bundled : null,
    bundledLibraryCount: platform === 'darwin' && bundled ? await countBundledLibraries() : null,
    runtimeLayout: bundled ? { executable: `bin/${executableName}`, libraries: platform === 'darwin' ? 'lib/*.dylib' : 'bin/*.dll' } : null,
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
  else if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) binaryPath = await prepareMacRuntime();
  else binaryPath = await prepareSystemRuntime();
  const manifest = await writeManifest(binaryPath);
  if (!binaryPath && strict) throw new Error(`AutoTrace runtime thiếu cho ${target}.`);
  if (platform === 'darwin' && strict && !manifest.bundled) throw new Error(`AutoTrace runtime macOS chưa được bundle cho ${target}.`);
  console.log(`AutoTrace runtime ${binaryPath ? 'ready' : 'optional/missing'}: ${JSON.stringify(manifest)}`);
} catch (error) {
  await writeManifest(null);
  if (strict) throw error;
  console.warn(`AutoTrace runtime không được chuẩn bị; app sẽ fallback sang VTracer: ${error.message || error}`);
}
