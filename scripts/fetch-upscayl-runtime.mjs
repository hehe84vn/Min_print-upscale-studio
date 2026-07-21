import { createWriteStream } from 'node:fs';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';

const CORE_MODELS = [
  'upscayl-standard-4x',
  'upscayl-lite-4x',
  'high-fidelity-4x',
  'remacri-4x',
  'ultramix-balanced-4x',
  'ultrasharp-4x',
  'digital-art-4x'
];

const REAL_ESRGAN_MODELS = [
  'realesrnet-x4plus',
  'realesrgan-x4plus'
];

const MODELS = [...CORE_MODELS, ...REAL_ESRGAN_MODELS];

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const platform = valueOf('--platform', process.platform);
const arch = valueOf('--arch', process.arch);
const tag = process.env.UPSCAYL_RELEASE_TAG || 'v2.15.0';
const version = tag.replace(/^v/, '');
const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'vendor', 'upscayl', `${platform}-${arch}`);

const realEsrganTag = 'v0.2.5.0';
// NCNN .param/.bin weights are platform-independent. The Ubuntu package is
// used consistently because it contains the complete model folder, while the
// macOS portable package is intended primarily as an executable bundle.
const realEsrganAssetName = 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip';
const realEsrganAssetUrl = `https://github.com/xinntao/Real-ESRGAN/releases/download/${realEsrganTag}/${realEsrganAssetName}`;

if (!['win32', 'darwin'].includes(platform)) {
  throw new Error(`Unsupported platform: ${platform}`);
}

const assetName = platform === 'win32'
  ? `upscayl-${version}-win.zip`
  : `upscayl-${version}-mac.zip`;
const assetUrl = `https://github.com/upscayl/upscayl/releases/download/${tag}/${assetName}`;

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function download(url, output) {
  const headers = { 'User-Agent': 'Min-Print-Upscale-Studio' };
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(output));
}

async function extract(archive, output) {
  await mkdir(output, { recursive: true });
  if (platform === 'win32') {
    const quote = (text) => text.replaceAll("'", "''");
    const command = `Expand-Archive -LiteralPath '${quote(archive)}' -DestinationPath '${quote(output)}' -Force`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
  } else {
    await run('ditto', ['-x', '-k', archive, output]);
  }
}

async function walk(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  await visit(directory);
  return files;
}

async function downloadFirstText(urls, output) {
  for (const url of urls) {
    const response = await fetch(url, { headers: { 'User-Agent': 'Min-Print-Upscale-Studio' } });
    if (response.ok) {
      await writeFile(output, await response.text(), 'utf8');
      return;
    }
  }
  throw new Error(`Could not download license: ${urls.join(', ')}`);
}

async function downloadUpscaylLicense(output) {
  await downloadFirstText(
    ['LICENSE', 'LICENSE.md'].map((name) => `https://raw.githubusercontent.com/upscayl/upscayl/${tag}/${name}`),
    output
  );
}

async function downloadRealEsrganLicense(output) {
  await downloadFirstText([
    `https://raw.githubusercontent.com/xinntao/Real-ESRGAN/${realEsrganTag}/LICENSE`,
    'https://raw.githubusercontent.com/xinntao/Real-ESRGAN/master/LICENSE'
  ], output);
}

async function reusableRuntime(manifestPath) {
  if (args.includes('--force') || !(await exists(manifestPath))) return false;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.models) || !MODELS.every((model) => manifest.models.includes(model))) return false;
    const binaryName = platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    if (!(await exists(path.join(destination, 'bin', binaryName)))) return false;
    for (const model of MODELS) {
      if (!(await exists(path.join(destination, 'models', `${model}.param`)))) return false;
      if (!(await exists(path.join(destination, 'models', `${model}.bin`)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifestPath = path.join(destination, 'runtime-manifest.json');
  if (await reusableRuntime(manifestPath)) {
    console.log(`[upscayl-runtime] Reusing ${destination}`);
    return;
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), 'upscayl-runtime-'));
  const archive = path.join(temp, assetName);
  const extracted = path.join(temp, 'upscayl-extracted');
  const realEsrganArchive = path.join(temp, realEsrganAssetName);
  const realEsrganExtracted = path.join(temp, 'realesrgan-extracted');

  try {
    console.log(`[upscayl-runtime] Downloading ${assetUrl}`);
    await download(assetUrl, archive);
    await extract(archive, extracted);

    console.log(`[upscayl-runtime] Downloading official Real-ESRGAN model weights from ${realEsrganAssetUrl}`);
    await download(realEsrganAssetUrl, realEsrganArchive);
    await extract(realEsrganArchive, realEsrganExtracted);

    const files = await walk(extracted);
    const realEsrganFiles = await walk(realEsrganExtracted);
    const binaryName = platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    const binary = files.find((file) => path.basename(file).toLowerCase() === binaryName);
    if (!binary) throw new Error(`${binaryName} was not found in ${assetName}.`);

    const namedFiles = new Map(files.map((file) => [path.basename(file).toLowerCase(), file]));
    const realEsrganNamedFiles = new Map(realEsrganFiles.map((file) => [path.basename(file).toLowerCase(), file]));

    for (const model of CORE_MODELS) {
      if (!namedFiles.has(`${model}.param`) || !namedFiles.has(`${model}.bin`)) {
        throw new Error(`The official Upscayl archive does not contain the complete ${model} model.`);
      }
    }

    for (const model of REAL_ESRGAN_MODELS) {
      if (!realEsrganNamedFiles.has(`${model}.param`) || !realEsrganNamedFiles.has(`${model}.bin`)) {
        const available = [...realEsrganNamedFiles.keys()]
          .filter((name) => name.endsWith('.param') || name.endsWith('.bin'))
          .sort()
          .join(', ');
        throw new Error(`The official Real-ESRGAN archive does not contain the complete ${model} model. Available model files: ${available || 'none'}`);
      }
    }

    await rm(destination, { recursive: true, force: true });
    await mkdir(path.join(destination, 'models'), { recursive: true });
    await cp(path.dirname(binary), path.join(destination, 'bin'), { recursive: true, force: true });

    for (const model of CORE_MODELS) {
      await cp(namedFiles.get(`${model}.param`), path.join(destination, 'models', `${model}.param`));
      await cp(namedFiles.get(`${model}.bin`), path.join(destination, 'models', `${model}.bin`));
    }

    for (const model of REAL_ESRGAN_MODELS) {
      await cp(realEsrganNamedFiles.get(`${model}.param`), path.join(destination, 'models', `${model}.param`));
      await cp(realEsrganNamedFiles.get(`${model}.bin`), path.join(destination, 'models', `${model}.bin`));
    }

    const installedBinary = path.join(destination, 'bin', binaryName);
    if (platform !== 'win32') await chmod(installedBinary, 0o755);

    await downloadUpscaylLicense(path.join(destination, 'UPSCAYL-AGPL-3.0.txt'));
    await downloadRealEsrganLicense(path.join(destination, 'REAL_ESRGAN-BSD-3-CLAUSE.txt'));
    await writeFile(path.join(destination, 'SOURCE_AND_CREDITS.md'), [
      '# Bundled local AI runtime and model sources',
      '',
      '## Native Local AI runtime',
      `Upscayl release: ${tag}`,
      `Source: https://github.com/upscayl/upscayl/tree/${tag}`,
      'Backend source: https://github.com/upscayl/upscayl-ncnn',
      `Original asset: ${assetUrl}`,
      '',
      '## Real-ESRGAN experimental benchmark model weights',
      `Release: ${realEsrganTag}`,
      'Source: https://github.com/xinntao/Real-ESRGAN',
      'NCNN source: https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan',
      `Model archive: ${realEsrganAssetUrl}`,
      'Models: realesrnet-x4plus, realesrgan-x4plus',
      '',
      'The Real-ESRGAN NCNN weights are platform-independent and are executed by the bundled native Local AI engine for the target platform.',
      'Upscayl and Real-ESRGAN are independent projects. Print Upscale Studio is not an official product of either project.'
    ].join('\n'), 'utf8');

    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 5,
      releaseTag: tag,
      assetName,
      assetUrl,
      platform,
      arch,
      binary: `bin/${binaryName}`,
      models: MODELS,
      modelSources: {
        upscayl: {
          releaseTag: tag,
          assetName,
          assetUrl,
          models: CORE_MODELS
        },
        realEsrgan: {
          releaseTag: realEsrganTag,
          assetName: realEsrganAssetName,
          assetUrl: realEsrganAssetUrl,
          models: REAL_ESRGAN_MODELS,
          runtime: 'bundled-native-local-engine',
          weightsPlatformIndependent: true
        }
      },
      preparedAt: new Date().toISOString()
    }, null, 2), 'utf8');

    console.log(`[upscayl-runtime] Prepared ${destination}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[upscayl-runtime] ${error.stack || error.message}`);
  process.exitCode = 1;
});
