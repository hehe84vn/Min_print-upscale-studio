import { createWriteStream } from 'node:fs';
import { access, chmod, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';

const MODELS = [
  'upscayl-standard-4x',
  'upscayl-lite-4x',
  'high-fidelity-4x',
  'remacri-4x',
  'ultramix-balanced-4x',
  'ultrasharp-4x',
  'digital-art-4x'
];

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

async function downloadLicense(output) {
  for (const name of ['LICENSE', 'LICENSE.md']) {
    const url = `https://raw.githubusercontent.com/upscayl/upscayl/${tag}/${name}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Min-Print-Upscale-Studio' } });
    if (response.ok) {
      await writeFile(output, await response.text(), 'utf8');
      return;
    }
  }
  throw new Error(`Could not download the Upscayl license for ${tag}.`);
}

async function main() {
  const manifestPath = path.join(destination, 'runtime-manifest.json');
  if (!args.includes('--force') && await exists(manifestPath)) {
    console.log(`[upscayl-runtime] Reusing ${destination}`);
    return;
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), 'upscayl-runtime-'));
  const archive = path.join(temp, assetName);
  const extracted = path.join(temp, 'extracted');

  try {
    console.log(`[upscayl-runtime] Downloading ${assetUrl}`);
    await download(assetUrl, archive);
    await extract(archive, extracted);

    const files = await walk(extracted);
    const binaryName = platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    const binary = files.find((file) => path.basename(file).toLowerCase() === binaryName);
    if (!binary) throw new Error(`${binaryName} was not found in ${assetName}.`);

    const namedFiles = new Map(files.map((file) => [path.basename(file).toLowerCase(), file]));
    for (const model of MODELS) {
      if (!namedFiles.has(`${model}.param`) || !namedFiles.has(`${model}.bin`)) {
        throw new Error(`The official archive does not contain the complete ${model} model.`);
      }
    }

    await rm(destination, { recursive: true, force: true });
    await mkdir(path.join(destination, 'models'), { recursive: true });
    await cp(path.dirname(binary), path.join(destination, 'bin'), { recursive: true, force: true });

    for (const model of MODELS) {
      await cp(namedFiles.get(`${model}.param`), path.join(destination, 'models', `${model}.param`));
      await cp(namedFiles.get(`${model}.bin`), path.join(destination, 'models', `${model}.bin`));
    }

    const installedBinary = path.join(destination, 'bin', binaryName);
    if (platform !== 'win32') await chmod(installedBinary, 0o755);

    await downloadLicense(path.join(destination, 'UPSCAYL-AGPL-3.0.txt'));
    await writeFile(path.join(destination, 'SOURCE_AND_CREDITS.md'), [
      '# Bundled Upscayl runtime',
      '',
      `Release: ${tag}`,
      `Source: https://github.com/upscayl/upscayl/tree/${tag}`,
      'Backend source: https://github.com/upscayl/upscayl-ncnn',
      `Original asset: ${assetUrl}`,
      '',
      'Upscayl is an independent AGPL-3.0 project. Print Upscale Studio is not an official Upscayl product.'
    ].join('\n'), 'utf8');

    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      releaseTag: tag,
      assetName,
      assetUrl,
      platform,
      arch,
      binary: `bin/${binaryName}`,
      models: MODELS,
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
