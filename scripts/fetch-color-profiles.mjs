import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'vendor', 'color-profiles');
const force = process.argv.includes('--force');

const archives = [
  {
    id: 'iso-coated-v2',
    label: 'ISO Coated v2 (ECI)',
    url: 'https://eci.org/lib/exe/eci_offset_2009.zip',
    candidates: [/^ISOcoated_v2_eci\.icc$/i, /^ISOcoated_v2_300_eci\.icc$/i]
  },
  {
    id: 'pso-coated-v3',
    label: 'PSO Coated v3 (FOGRA51)',
    url: 'https://eci.org/lib/exe/pso-coated_v3.zip',
    candidates: [/^PSOcoated_v3\.icc$/i]
  },
  {
    id: 'pso-uncoated-v3',
    label: 'PSO Uncoated v3 (FOGRA52)',
    url: 'https://eci.org/lib/exe/pso-uncoated_v3_fogra52.zip',
    candidates: [/^PSOuncoated_v3_FOGRA52\.icc$/i, /^PSOuncoated_v3.*\.icc$/i]
  }
];

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function download(url, output) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Min-Print-Upscale-Studio' },
    redirect: 'follow'
  });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(response.body, createWriteStream(output));
}

async function extract(archive, output) {
  await mkdir(output, { recursive: true });
  if (process.platform === 'win32') {
    const quote = (text) => text.replaceAll("'", "''");
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${quote(archive)}' -DestinationPath '${quote(output)}' -Force`]);
  } else if (process.platform === 'darwin') {
    await run('ditto', ['-x', '-k', archive, output]);
  } else {
    await run('unzip', ['-q', '-o', archive, '-d', output]);
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

async function main() {
  const manifestPath = path.join(destination, 'profiles-manifest.json');
  if (!force && await exists(manifestPath)) {
    console.log(`[color-profiles] Reusing ${destination}`);
    return;
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), 'print-upscale-color-profiles-'));
  const profiles = [];
  try {
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });

    for (const source of archives) {
      const archivePath = path.join(temp, `${source.id}.zip`);
      const extractPath = path.join(temp, source.id);
      console.log(`[color-profiles] Downloading ${source.label}`);
      await download(source.url, archivePath);
      await extract(archivePath, extractPath);
      const files = await walk(extractPath);
      const profile = source.candidates
        .map((pattern) => files.find((file) => pattern.test(path.basename(file))))
        .find(Boolean);
      if (!profile) throw new Error(`Could not find ICC profile for ${source.label}. Files: ${files.map((file) => path.basename(file)).join(', ')}`);
      const filename = `${source.id}.icc`;
      await cp(profile, path.join(destination, filename));
      profiles.push({ id: source.id, label: source.label, filename, sourceUrl: source.url });
    }

    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      preparedAt: new Date().toISOString(),
      profiles
    }, null, 2), 'utf8');
    await writeFile(path.join(destination, 'SOURCE_AND_CREDITS.md'), [
      '# ECI colour profiles',
      '',
      'Profiles in this directory were downloaded from the European Color Initiative (ECI).',
      'Source page: https://eci.org/doku.php?id=en:downloads',
      '',
      ...profiles.map((profile) => `- ${profile.label}: ${profile.sourceUrl}`),
      '',
      'Use the profile that matches the actual printing condition. These profiles do not make a file production-ready by themselves.'
    ].join('\n'), 'utf8');
    console.log(`[color-profiles] Prepared ${profiles.length} profiles in ${destination}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[color-profiles] ${error.stack || error.message}`);
  process.exitCode = 1;
});
