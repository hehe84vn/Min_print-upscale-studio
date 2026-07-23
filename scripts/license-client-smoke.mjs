import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (value) => fs.readFileSync(path.join(root, value), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const bootstrap = read('src/main/bootstrap.js');
const config = read('src/main/licenseConfig.js');
const service = read('src/main/services/licenseService.js');
const preload = read('src/main/preload.js');
const zoom = read('src/renderer/zoom.js');
const ui = read('src/renderer/license-ui.js');
const gateway = read('supabase/functions/license-gateway/index.ts');

assert.equal(packageJson.main, 'src/main/bootstrap.js', 'Electron entrypoint must enforce the license bootstrap.');
for (const channel of ['image:process', 'production:start', 'benchmark:run', 'color:convert']) {
  assert.match(bootstrap, new RegExp(channel.replace(':', '\\:')), `Protected channel missing: ${channel}`);
}
assert.match(bootstrap, /ensureProcessingAllowed/);
assert.match(bootstrap, /makeInitializationIdempotent/);
assert.match(bootstrap, /force: payload\.force === true/);
assert.match(bootstrap, /license:login/);
assert.match(bootstrap, /license:deactivate/);

assert.match(config, /sb_publishable_/);
assert.match(config, /BEGIN PUBLIC KEY/);
assert.doesNotMatch(config, /PRIVATE KEY|service_role|SUPABASE_ACCESS_TOKEN/);
const pem = config.match(/publicKeyPem: `([\s\S]*?)`/)?.[1];
assert.ok(pem, 'License public key PEM is missing.');
const publicKey = crypto.createPublicKey(pem);
assert.equal(publicKey.asymmetricKeyType, 'rsa');
assert.equal(publicKey.asymmetricKeyDetails?.modulusLength, 3072);

assert.match(service, /safeStorage|secureSecretsService/);
assert.match(service, /RSA_PKCS1_PSS_PADDING/);
assert.match(service, /offline_entitlement_expired/);
assert.match(service, /_blockNonRetriable/);
assert.match(service, /remove\(SECRET\.entitlement\)/);
assert.match(service, /generateKeyPairSync\('ec'/);
assert.match(service, /dsaEncoding: 'ieee-p1363'/);
assert.match(service, /proofTimestamp/);
assert.match(service, /deviceProof/);

for (const api of ['getLicenseStatus', 'loginLicense', 'validateLicense', 'logoutLicense', 'deactivateLicense', 'onLicenseStatus']) {
  assert.match(preload, new RegExp(api), `Preload license API missing: ${api}`);
}
assert.match(preload, /getLicenseStatus: \(force = false\)/);
assert.match(zoom, /license-ui\.js/);
assert.match(ui, /licenseLoginForm/);
assert.match(ui, /getLicenseStatus\(true\)/);
assert.match(ui, /Hủy kích hoạt thiết bị/);

assert.match(gateway, /verifyDeviceProof/);
assert.match(gateway, /DEVICE_PROOF_WINDOW_MS/);
assert.match(gateway, /invalid_device_proof/);
assert.match(gateway, /namedCurve: 'P-256'/);

const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const message = Buffer.from('validate\nabc\n123');
const signature = crypto.sign('sha256', message, { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
const webKey = await crypto.webcrypto.subtle.importKey(
  'spki',
  spki,
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['verify']
);
assert.equal(
  await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, webKey, signature, message),
  true,
  'Node device proof must verify with WebCrypto used by Supabase Edge Functions.'
);

console.log('License client smoke test passed.');
