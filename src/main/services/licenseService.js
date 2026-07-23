'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const SECRET_NAMES = Object.freeze({
  session: 'licenseSessionV1',
  entitlement: 'licenseEntitlementV1',
  installationId: 'licenseInstallationIdV1',
  devicePrivateKey: 'licenseDevicePrivateKeyV1',
  devicePublicKey: 'licenseDevicePublicKeyV1'
});

const ERROR_MESSAGES = Object.freeze({
  invalid_login: 'Email hoặc mật khẩu không đúng.',
  email_not_confirmed: 'Tài khoản chưa được xác nhận email.',
  license_not_assigned: 'Tài khoản này chưa được cấp license.',
  license_expired: 'License đã hết hạn.',
  license_suspended: 'License đang bị tạm khóa.',
  license_revoked: 'License đã bị thu hồi.',
  device_limit_reached: 'License đã đạt giới hạn thiết bị. Hãy hủy thiết bị cũ trước khi kích hoạt máy này.',
  device_revoked: 'Thiết bị này đã bị thu hồi quyền sử dụng.',
  device_not_activated: 'Thiết bị chưa được kích hoạt.',
  invalid_entitlement: 'Không thể xác minh quyền sử dụng offline.',
  offline_entitlement_expired: 'Quyền sử dụng offline đã hết hạn. Hãy kết nối Internet để xác minh lại.',
  network_unavailable: 'Không thể kết nối máy chủ license.',
  license_required: 'Cần đăng nhập tài khoản có license để xử lý ảnh.'
});

class LicenseError extends Error {
  constructor(code, message, options = {}) {
    super(message || ERROR_MESSAGES[code] || 'Không thể xác minh license.');
    this.name = 'LicenseError';
    this.code = code;
    this.httpStatus = options.httpStatus || null;
    this.retriable = options.retriable === true;
  }
}

function base64UrlToBuffer(value) {
  const normalized = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function bufferToBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function safeDate(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

class LicenseService {
  constructor({ secureSecretsService, config, appVersion }) {
    this.secureSecretsService = secureSecretsService;
    this.config = {
      ...config,
      supabaseUrl: normalizeUrl(config?.supabaseUrl)
    };
    this.appVersion = String(appVersion || '0.0.0');
    this.initializationPromise = null;
    this.lastOnlineValidationAt = 0;
    this.currentStatus = this._status({
      state: 'checking',
      processingAllowed: false,
      message: 'Đang kiểm tra quyền sử dụng...'
    });
  }

  _status(overrides = {}) {
    return {
      configured: Boolean(this.config.supabaseUrl && this.config.publishableKey && this.config.publicKeyPem),
      state: 'signed_out',
      processingAllowed: false,
      online: false,
      email: null,
      plan: null,
      validUntil: null,
      offlineRemainingMs: 0,
      maxDevices: null,
      deviceName: os.hostname(),
      message: ERROR_MESSAGES.license_required,
      code: 'license_required',
      ...overrides
    };
  }

  _setStatus(overrides = {}) {
    this.currentStatus = this._status(overrides);
    return this.getCachedStatus();
  }

  getCachedStatus() {
    return { ...this.currentStatus };
  }

  async _readJsonSecret(name) {
    const value = await this.secureSecretsService.get(name);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      await this.secureSecretsService.remove(name);
      return null;
    }
  }

  async _writeJsonSecret(name, value) {
    await this.secureSecretsService.set(name, JSON.stringify(value));
  }

  async _ensureDeviceIdentity({ rotate = false } = {}) {
    if (rotate) {
      await Promise.all([
        this.secureSecretsService.remove(SECRET_NAMES.installationId),
        this.secureSecretsService.remove(SECRET_NAMES.devicePrivateKey),
        this.secureSecretsService.remove(SECRET_NAMES.devicePublicKey)
      ]);
    }

    let installationId = await this.secureSecretsService.get(SECRET_NAMES.installationId);
    let privateKeyPem = await this.secureSecretsService.get(SECRET_NAMES.devicePrivateKey);
    let publicKeyPem = await this.secureSecretsService.get(SECRET_NAMES.devicePublicKey);

    if (!installationId) {
      installationId = crypto.randomUUID();
      await this.secureSecretsService.set(SECRET_NAMES.installationId, installationId);
    }

    if (!privateKeyPem || !publicKeyPem) {
      const pair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      privateKeyPem = pair.privateKey;
      publicKeyPem = pair.publicKey;
      await this.secureSecretsService.set(SECRET_NAMES.devicePrivateKey, privateKeyPem);
      await this.secureSecretsService.set(SECRET_NAMES.devicePublicKey, publicKeyPem);
    }

    const installationHash = crypto
      .createHash('sha256')
      .update(`print-upscale-studio:${installationId}`)
      .digest('hex');

    return { installationHash, privateKeyPem, publicKeyPem };
  }

  async _requestJson(url, { method = 'POST', headers = {}, body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(this.config.requestTimeoutMs) || 10_000);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch { data = { message: text }; }
      }

      if (!response.ok) {
        const rawCode = data.error || data.error_code || data.code || '';
        const code = rawCode === 'invalid_credentials' ? 'invalid_login' : String(rawCode || `http_${response.status}`);
        const fallbackMessage = data.msg || data.message || data.error_description;
        throw new LicenseError(code, ERROR_MESSAGES[code] || fallbackMessage, {
          httpStatus: response.status,
          retriable: response.status >= 500
        });
      }

      return data;
    } catch (error) {
      if (error instanceof LicenseError) throw error;
      const timedOut = error?.name === 'AbortError';
      throw new LicenseError(
        'network_unavailable',
        timedOut ? 'Máy chủ license phản hồi quá chậm.' : ERROR_MESSAGES.network_unavailable,
        { retriable: true }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async _authenticateWithPassword(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    if (!normalizedEmail || !normalizedPassword) {
      throw new LicenseError('invalid_login', 'Nhập đầy đủ email và mật khẩu.');
    }

    const result = await this._requestJson(
      `${this.config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        headers: { apikey: this.config.publishableKey },
        body: { email: normalizedEmail, password: normalizedPassword }
      }
    );

    const session = this._normalizeSession(result);
    await this._writeJsonSecret(SECRET_NAMES.session, session);
    return session;
  }

  _normalizeSession(value) {
    const accessToken = String(value?.access_token || '');
    const refreshToken = String(value?.refresh_token || '');
    if (!accessToken || !refreshToken) {
      throw new LicenseError('invalid_login', 'Máy chủ không trả về phiên đăng nhập hợp lệ.');
    }

    const expiresAt = Number(value.expires_at)
      ? Number(value.expires_at) * 1000
      : Date.now() + Math.max(60, Number(value.expires_in) || 3600) * 1000;

    return {
      accessToken,
      refreshToken,
      expiresAt,
      user: {
        id: value.user?.id || null,
        email: value.user?.email || null
      }
    };
  }

  async _loadSession() {
    return this._readJsonSecret(SECRET_NAMES.session);
  }

  async _refreshSession(session) {
    const result = await this._requestJson(
      `${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        headers: { apikey: this.config.publishableKey },
        body: { refresh_token: session.refreshToken }
      }
    );
    const refreshed = this._normalizeSession(result);
    await this._writeJsonSecret(SECRET_NAMES.session, refreshed);
    return refreshed;
  }

  async _ensureFreshSession() {
    let session = await this._loadSession();
    if (!session?.accessToken || !session?.refreshToken) {
      throw new LicenseError('license_required');
    }

    if (Number(session.expiresAt) <= Date.now() + 60_000) {
      try {
        session = await this._refreshSession(session);
      } catch (error) {
        if (error instanceof LicenseError && !error.retriable) {
          await this.secureSecretsService.remove(SECRET_NAMES.session);
        }
        throw error;
      }
    }
    return session;
  }

  _signDeviceProof(action, installationHash, timestamp, privateKeyPem) {
    const payload = Buffer.from(`${action}\n${installationHash}\n${timestamp}`, 'utf8');
    const signature = crypto.sign('sha256', payload, {
      key: privateKeyPem,
      dsaEncoding: 'ieee-p1363'
    });
    return bufferToBase64Url(signature);
  }

  _verifyEntitlementBundle(bundle, installationHash) {
    if (!bundle?.entitlement || !bundle?.signature) {
      throw new LicenseError('invalid_entitlement');
    }

    const payload = Buffer.from(JSON.stringify(bundle.entitlement), 'utf8');
    const signature = base64UrlToBuffer(bundle.signature);
    const validSignature = crypto.verify(
      'sha256',
      payload,
      {
        key: this.config.publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32
      },
      signature
    );

    if (!validSignature || bundle.entitlement.version !== 1) {
      throw new LicenseError('invalid_entitlement');
    }
    if (bundle.entitlement.installationHash !== installationHash) {
      throw new LicenseError('invalid_entitlement', 'License offline không thuộc thiết bị này.');
    }

    const validUntilMs = safeDate(bundle.entitlement.validUntil);
    const now = Date.now();
    const cryptographicallyValid = validUntilMs > 0;
    const active = cryptographicallyValid && validUntilMs + Number(this.config.clockToleranceMs || 0) > now;

    return {
      active,
      expired: cryptographicallyValid && !active,
      validUntilMs,
      entitlement: bundle.entitlement,
      bundle
    };
  }

  async _readVerifiedEntitlement() {
    const identity = await this._ensureDeviceIdentity();
    const bundle = await this._readJsonSecret(SECRET_NAMES.entitlement);
    if (!bundle) return null;
    try {
      return this._verifyEntitlementBundle(bundle, identity.installationHash);
    } catch {
      await this.secureSecretsService.remove(SECRET_NAMES.entitlement);
      return null;
    }
  }

  _statusFromVerified(verified, { online, message } = {}) {
    const entitlement = verified.entitlement;
    return this._setStatus({
      state: online ? 'active_online' : 'active_offline',
      processingAllowed: verified.active,
      online: Boolean(online),
      email: entitlement.email || null,
      plan: entitlement.plan || null,
      validUntil: entitlement.validUntil || null,
      offlineRemainingMs: Math.max(0, verified.validUntilMs - Date.now()),
      maxDevices: entitlement.maxDevices ?? null,
      message: message || (online ? 'License đã được xác minh trực tuyến.' : 'Đang sử dụng quyền offline đã ký.'),
      code: verified.active ? null : 'offline_entitlement_expired'
    });
  }

  async _callGateway(action) {
    const session = await this._ensureFreshSession();
    const identity = await this._ensureDeviceIdentity();
    const timestamp = String(Date.now());
    const deviceProof = this._signDeviceProof(action, identity.installationHash, timestamp, identity.privateKeyPem);

    const result = await this._requestJson(
      `${this.config.supabaseUrl}/functions/v1/${this.config.functionName}`,
      {
        headers: {
          apikey: this.config.publishableKey,
          Authorization: `Bearer ${session.accessToken}`
        },
        body: {
          action,
          installationHash: identity.installationHash,
          devicePublicKey: identity.publicKeyPem,
          deviceProof,
          proofTimestamp: timestamp,
          platform: process.platform,
          architecture: process.arch,
          deviceName: os.hostname(),
          appVersion: this.appVersion
        }
      }
    );

    if (action === 'deactivate') return result;

    const bundle = { entitlement: result.entitlement, signature: result.signature };
    const verified = this._verifyEntitlementBundle(bundle, identity.installationHash);
    if (!verified.active) throw new LicenseError('offline_entitlement_expired');
    await this._writeJsonSecret(SECRET_NAMES.entitlement, bundle);
    this.lastOnlineValidationAt = Date.now();
    return verified;
  }

  async initialize() {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this._initializeInternal().finally(() => {
      this.initializationPromise = null;
    });
    return this.initializationPromise;
  }

  async _initializeInternal() {
    if (!this.currentStatus.configured) {
      return this._setStatus({
        state: 'blocked',
        processingAllowed: false,
        message: 'Ứng dụng chưa được cấu hình máy chủ license.',
        code: 'license_config_missing'
      });
    }

    const [session, offline] = await Promise.all([
      this._loadSession(),
      this._readVerifiedEntitlement()
    ]);

    if (!session) {
      return this._setStatus({
        state: 'signed_out',
        processingAllowed: false,
        message: ERROR_MESSAGES.license_required,
        code: 'license_required'
      });
    }

    try {
      const verified = await this._callGateway(offline?.active ? 'validate' : 'activate');
      return this._statusFromVerified(verified, { online: true });
    } catch (error) {
      if (error instanceof LicenseError && error.retriable && offline?.active) {
        return this._statusFromVerified(offline, {
          online: false,
          message: 'Không có kết nối máy chủ. App đang dùng quyền offline còn hiệu lực.'
        });
      }
      return this._setStatus({
        state: error?.code === 'license_required' ? 'signed_out' : 'blocked',
        processingAllowed: false,
        message: error?.message || 'Không thể xác minh license.',
        code: error?.code || 'license_validation_failed'
      });
    }
  }

  async login(email, password) {
    await this._authenticateWithPassword(email, password);
    try {
      const verified = await this._callGateway('activate');
      return this._statusFromVerified(verified, { online: true, message: 'Đăng nhập và kích hoạt thiết bị thành công.' });
    } catch (error) {
      await this.secureSecretsService.remove(SECRET_NAMES.session);
      await this.secureSecretsService.remove(SECRET_NAMES.entitlement);
      throw error;
    }
  }

  async validateNow() {
    const verified = await this._callGateway('validate');
    return this._statusFromVerified(verified, { online: true });
  }

  async ensureProcessingAllowed() {
    await this.initialize();
    let offline = await this._readVerifiedEntitlement();
    if (!offline?.active) {
      throw new LicenseError(
        offline?.expired ? 'offline_entitlement_expired' : 'license_required',
        offline?.expired ? ERROR_MESSAGES.offline_entitlement_expired : ERROR_MESSAGES.license_required
      );
    }

    const issuedAtMs = safeDate(offline.entitlement.issuedAt);
    const validationAge = Date.now() - Math.max(this.lastOnlineValidationAt, issuedAtMs);
    if (validationAge >= Number(this.config.onlineValidationIntervalMs || 0)) {
      try {
        const verified = await this._callGateway('validate');
        this._statusFromVerified(verified, { online: true });
        return true;
      } catch (error) {
        if (!(error instanceof LicenseError) || !error.retriable) {
          this._setStatus({
            state: 'blocked',
            processingAllowed: false,
            message: error?.message || 'License không còn hợp lệ.',
            code: error?.code || 'license_validation_failed'
          });
          throw error;
        }
        offline = await this._readVerifiedEntitlement();
        if (!offline?.active) throw new LicenseError('offline_entitlement_expired');
        this._statusFromVerified(offline, { online: false, message: 'Đang xử lý bằng quyền offline còn hiệu lực.' });
      }
    }
    return true;
  }

  async logout({ deactivate = false } = {}) {
    let session = await this._loadSession();
    if (deactivate) {
      await this._callGateway('deactivate');
    }

    if (session?.accessToken) {
      try {
        await this._requestJson(`${this.config.supabaseUrl}/auth/v1/logout`, {
          headers: {
            apikey: this.config.publishableKey,
            Authorization: `Bearer ${session.accessToken}`
          },
          body: {}
        });
      } catch {
        // Local logout must still complete when the network is unavailable.
      }
    }

    await Promise.all([
      this.secureSecretsService.remove(SECRET_NAMES.session),
      this.secureSecretsService.remove(SECRET_NAMES.entitlement)
    ]);

    if (deactivate) {
      await this._ensureDeviceIdentity({ rotate: true });
    }

    session = null;
    return this._setStatus({
      state: 'signed_out',
      processingAllowed: false,
      message: deactivate ? 'Đã hủy kích hoạt thiết bị và đăng xuất.' : 'Đã đăng xuất.',
      code: 'license_required'
    });
  }
}

module.exports = { LicenseService, LicenseError, SECRET_NAMES };
