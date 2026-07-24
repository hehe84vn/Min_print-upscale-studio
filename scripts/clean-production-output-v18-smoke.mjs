import fs from 'node:fs';
import assert from 'node:assert/strict';

const service = fs.readFileSync(new URL('../src/main/services/benchmarkService.js', import.meta.url), 'utf8');

assert.match(service, /const maskWorkspace = path\.join\(workspace, 'masks'\)/);
assert.doesNotMatch(service, /path\.join\(sessionDirectory, `\$\{prefix\}_protection-mask\.png`\)/);
assert.doesNotMatch(service, /path\.join\(sessionDirectory, 'benchmark-report\.json'\)/);
assert.doesNotMatch(service, /path\.join\(sessionDirectory, 'upscale-quality-check\.json'\)/);
assert.match(service, /reportPath: null/);
assert.match(service, /qualityCheckReportPath: null/);
assert.match(service, /diagnostics/);
assert.match(service, /fs\.rm\(workspace, \{ recursive: true, force: true \}\)/);

console.log('Clean Production Output V18 smoke test passed.');
