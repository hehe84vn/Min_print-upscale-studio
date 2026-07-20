import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const target = join(directory, entry);
    return statSync(target).isDirectory() ? walk(target) : [target];
  });
}

const files = ['src', 'scripts']
  .flatMap(walk)
  .filter((file) => ['.js', '.mjs'].includes(extname(file)));

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax OK: ${files.length} JavaScript files.`);
