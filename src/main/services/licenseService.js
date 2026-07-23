'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const SECRET = Object.freeze({
  session: 'licenseSessionV1',
  entitlement: 'licenseEntitlementV1',
  installation: 'licenseInstallationIdV1',
  privateKey: 'licenseDevicePrivateKeyV1',
  publicKey: 'licenseDevicePublicKeyV1'
});

const MESSAGE = Object.freeze({
  invalid_login: 'Email hoặc mật khẩu không đúng.',
  email_not_confirmed: 'Tài khoản chưa được xác nhận email.',
  license_not_assigned: 'Tài khoản này chưa được cấp license.',
  license_expired: 'License đã hết hạn.',
  license_suspended: 'License đang bị tạm khóa.',
  license_revoked: 'License đã bị thu hồi.',
  device_limit_reached: 'License đã đạt giới hạn thiết bị. Hãy hủy thiết bị cũ trước khi kích hoạt máy này.',
  device_revoked: 'Thiết bị này đã bị thu hồi quyền sử dụng.',
  device_not_activated: 'Thiết bị chưa được kích hoạt.',
  invalid_device_proof: 'Không thể xác minh khóa bảo mật của thiết bị.',
  invalid_entitlement: 'Không thể xác minh quyền sử dụng offline.',
  offline_entitlement_expired: 'Quyền sử dụng offline đã hết hạn. Hãy kết nối Internet để xác minh lại.',
  network_unavailable: 'Không thể kết nối máy chủ license.',
  license_required: 'Cần đăng nhập tài khoản có license để xử lý ảnh.'
});

class LicenseError extends Error {
  constructor(code, message, { httpStatus = null, retriable = false } = {}) {
    super(message || MESSAGE[code] || 'Không thể xác minh license.');
    this.name = 'LicenseError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retriable = retriable;
  }
}

const trimUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const dateMs = (value) => {
  const result = new Date(value || 0).getTime();
  return Number.isFinite(result) ? result : 0;
};
const fromBase64Url = (value) => Buffer.from(String(value || ''), 'base64url');

class LicenseService {
  constructor({ secureSecretsService, config, appVersion }) {
    this.secure = secureSecretsService;
    this.config = { ...config, supabaseUrl: trimUrl(config?.supabaseUrl) };
    this.appVersion = String(appVersion || '0.0.0');
    this.lastOnlineValidationAt = 0;
    this.status = this._status('checking', false, 'Đang kiểm tra quyền sử dụng...');
  }

  _status(state, processingAllowed, message, extra = {}) {
    return {
      configured: Boolean(this.config.supabaseUrl && this.config.publishableKey && this.config.publicKeyPem),
      state,
      processingAllowed,
      online: false,
      email: null,
      plan: null,
      validUntil: null,
      offlineRemainingMs: 0,
      maxDevices: null,
      deviceName: os.hostname(),
      message,
      code: processingAllowed ? null : 'license_required',
      ...extra
    };
  }

  _set(state, processingAllowed, message, extra = {}) {
    this.status = this._status(state, processingAllowed, message, extra);
    return this.getCachedStatus();
  }

  getCachedStatus() {
    return { ...this.status };
  }

  async _readJson(name) {
    const raw = await this.secure.get(name);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch {
      await this.secure.remove(name);
      return null;
    }
  }

  _writeJson(name, value) {
    return this.secure.set(name, JSON.stringify(value));
  }

  async _identity({ rotate = false } = {}) {
    if (rotate) {
      await Promise.all([SECRET.installation, SECRET.privateKey, SECRET.publicKey].map((name) => this.secure.remove(name)));
    }

    let installationId = await this.secure.get(SECRET.installation);
    let privateKey = await this.secure.get(SECRET.privateKey);
    let publicKey = await this.secure.get(SECRET.publicKey);

    if (!installationId) {
      installationId = crypto.randomUUID();
      await this.secure.set(SECRET.installation, installationId);
    }
    if (!privateKey || !publicKey) {
      const pair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      ({ privateKey, publicKey } = pair);
      await this.secure.set(SECRET.privateKey, privateKey);
      await this.secure.set(SECRET.publicKey, publicKey);
    }

    const installationHash = crypto.createHash('sha256')
      .update(`print-upscale-studio:${installationId}`)
      .digest('hex');
    return { installationHash, privateKey, publicKey };
  }

  async _request(url, { headers = {}, body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(this.config.requestTimeoutMs) || 10_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
      if (!response.ok) {
        const raw = data.error || data.error_code || data.code || `http_${response.status}`;
        const code = raw === 'invalid_credentials' ? 'invalid_login' : String(raw);
        throw new LicenseError(code, MESSAGE[code] || data.msg || data.message || data.error_description, {
          httpStatus: response.status,
          retriable: response.status >= 500
        });
      }
      return data;
    } catch (error) {
      if (error instanceof LicenseError) throw error;
      throw new LicenseError(
        'network_unavailable',
        error?.name === 'AbortError' ? 'Máy chủ license phản hồi quá chậm.' : MESSAGE.network_unavailable,
        { retriable: true }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  _normalizeSession(value) {
    if (!value?.access_token || !value?.refresh_token) throw new LicenseError('invalid_login');
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: Number(value.expires_at)
        ? Number(value.expires_at) * 1000
        : Date.now() + Math.max(60, Number(value.expires_in) || 3600) * 1000,
      user: { id: value.user?.id || null, email: value.user?.email || null }
    };
  }

  async _passwordLogin(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !String(password || '')) throw new LicenseError('invalid_login', 'Nhập đầy đủ email và mật khẩu.');
    const data = await this._request(`${this.config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: this.config.publishableKey },
      body: { email: normalizedEmail, password: String(password) }
    });
    const session = this._normalizeSession(data);
    await this._writeJson(SECRET.session, session);
    return session;
  }

  async _freshSession() {
    let session = await this._readJson(SECRET.session);
    if (!session?.accessToken || !session?.refreshToken) throw new LicenseError('license_required');
    if (Number(session.expiresAt) > Date.now() + 60_000) return session;

    try {
      const data = await this._request(`${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        headers: { apikey: this.config.publishableKey },
        body: { refresh_token: session.refreshToken }
      });
      session = this._normalizeSession(data);
      await this._writeJson(SECRET.session, session);
      return session;
    } catch (error) {
      if (error instanceof LicenseError && !error.retriable) await this.secure.remove(SECRET.session);
      throw error;
    }
  }

  _proof(action, identity, timestamp) {
    return crypto.sign(
      'sha256',
      Buffer.from(`${action}\n${identity.installationHash}\n${timestamp}`),
      { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }
    ).toString('base64url');
  }

  _verify(bundle, installationHash) {
    if (!bundle?.entitlement || !bundle?.signature) throw new LicenseError('invalid_entitlement');
    const valid = crypto.verify(
      'sha256',
      Buffer.from(JSON.stringify(bundle.entitlement)),
      { key: this.config.publicKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
      fromBase64Url(bundle.signature)
    );
    if (!valid || bundle.entitlement.version !== 1 || bundle.entitlement.installationHash !== installationHash) {
      throw new LicenseError('invalid_entitlement');
    }
    const validUntilMs = dateMs(bundle.entitlement.validUntil);
    const active = validUntilMs > 0 && validUntilMs + Number(this.config.clockToleranceMs || 0) > Date.now();
    return { active, expired: validUntilMs > 0 && !active, validUntilMs, entitlement: bundle.entitlement, bundle };
  }

  async _offline() {
    const identity = await this._identity();
    const bundle = await this._readJson(SECRET.entitlement);
    if (!bundle) return null;
    try { return this._verify(bundle, identity.installationHash); } catch {
      await this.secure.remove(SECRET.entitlement);
      return null;
    }
  }

  _fromEntitlement(verified, online, message) {
    const item = verified.entitlement;
    return this._set(online ? 'active_online' : 'active_offline', verified.active, message || (
      online ? 'License đã được xác minh trực tuyến.' : 'Đang sử dụng quyền offline đã ký.'
    ), {
      online,
      email: item.email || null,
      plan: item.plan || null,
      validUntil: item.validUntil || null,
      offlineRemainingMs: Math.max(0, verified.validUntilMs - Date.now()),
      maxDevices: item.maxDevices ?? null,
      code: verified.active ? null : 'offline_entitlement_expired'
    });
  }

  async _gateway(action) {
    const session = await this._freshSession();
    const identity = await this._identity();
    const proofTimestamp = String(Date.now());
    const data = await this._request(`${this.config.supabaseUrl}/functions/v1/${this.config.functionName}`, {
      headers: { apikey: this.config.publishableKey, Authorization: `Bearer ${session.accessToken}` },
      body: {
        action,
        installationHash: identity.installationHash,
        devicePublicKey: identity.publicKey,
        deviceProof: this._proof(action, identity, proofTimestamp),
        proofTimestamp,
        platform: process.platform,
        architecture: process.arch,
        deviceName: os.hostname(),
        appVersion: this.appVersion
      }
    });
    if (action === 'deactivate') return data;

    const verified = this._verify({ entitlement: data.entitlement, signature: data.signature }, identity.installationHash);
    if (!verified.active) throw new LicenseError('offline_entitlement_expired');
    await this._writeJson(SECRET.entitlement, verified.bundle);
    this.lastOnlineValidationAt = Date.now();
    return verified;
  }

  async initialize() {
    if (!this.status.configured) {
      return this._set('blocked', false, 'Ứng dụng chưa được cấu hình máy chủ license.', { code: 'license_config_missing' });
    }
    const [session, offline] = await Promise.all([this._readJson(SECRET.session), this._offline()]);
    if (!session) return this._set('signed_out', false, MESSAGE.license_required);
    try {
      return this._fromEntitlement(await this._gateway(offline?.active ? 'validate' : 'activate'), true);
    } catch (error) {
      if (error instanceof LicenseError && error.retriable && offline?.active) {
        return this._fromEntitlement(offline, false, 'Không có kết nối máy chủ. App đang dùng quyền offline còn hiệu lực.');
      }
      return this._set(error?.code === 'license_required' ? 'signed_out' : 'blocked', false, error?.message || 'Không thể xác minh license.', {
        code: error?.code || 'license_validation_failed'
      });
    }
  }

  async login(email, password) {
    await this._passwordLogin(email, password);
    try {
      return this._fromEntitlement(await this._gateway('activate'), true, 'Đăng nhập và kích hoạt thiết bị thành công.');
    } catch (error) {
      await Promise.all([this.secure.remove(SECRET.session), this.secure.remove(SECRET.entitlement)]);
      throw error;
    }
  }

  async validateNow() {
    return this._fromEntitlement(await this._gateway('validate'), true);
  }

  async ensureProcessingAllowed() {
    await this.initialize();
    let offline = await this._offline();
    if (!offline?.active) {
      throw new LicenseError(offline?.expired ? 'offline_entitlement_expired' : 'license_required');
    }

    const age = Date.now() - Math.max(this.lastOnlineValidationAt, dateMs(offline.entitlement.issuedAt));
    if (age < Number(this.config.onlineValidationIntervalMs || 0)) return true;
    try {
      this._fromEntitlement(await this._gateway('validate'), true);
    } catch (error) {
      if (!(error instanceof LicenseError) || !error.retriable) {
        this._set('blocked', false, error?.message || 'License không còn hợp lệ.', { code: error?.code || 'license_validation_failed' });
        throw error;
      }
      offline = await this._offline();
      if (!offline?.active) throw new LicenseError('offline_entitlement_expired');
      this._fromEntitlement(offline, false, 'Đang xử lý bằng quyền offline còn hiệu lực.');
    }
    return true;
  }

  async logout({ deactivate = false } = {}) {
    const session = await this._readJson(SECRET.session);
    if (deactivate) await this._gateway('deactivate');
    if (session?.accessToken) {
      try {
        await this._request(`${this.config.supabaseUrl}/auth/v1/logout`, {
          headers: { apikey: this.config.publishableKey, Authorization: `Bearer ${session.accessToken}` }
        });
      } catch { /* local logout must still complete offline */ }
    }
    await Promise.all([this.secure.remove(SECRET.session), this.secure.remove(SECRET.entitlement)]);
    if (deactivate) await this._identity({ rotate: true });
    return this._set('signed_out', false, deactivate ? 'Đã hủy kích hoạt thiết bị và đăng xuất.' : 'Đã đăng xuất.');
  }
}

module.exports = { LicenseService, LicenseError, SECRET_NAMES: SECRET };
