import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(packageJson.version, '3.0.0');
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /version:/);
assert.match(workflow, /push:\s*\n\s*tags:/);
assert.match(workflow, /Requested version .* does not match package/);
assert.match(workflow, /dist:win/);
assert.match(workflow, /dist:mac:\$\{\{ matrix\.arch \}\}/);
assert.match(workflow, /tag_name: \$\{\{ needs\.validate\.outputs\.tag \}\}/);
assert.match(workflow, /target_commitish: \$\{\{ github\.sha \}\}/);
assert.match(workflow, /make_latest: true/);
assert.match(workflow, /softprops\/action-gh-release@v2/);

console.log('Release and Auto Update Validation V20 smoke test passed.');
