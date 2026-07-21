const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

class SecureSecretsService {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'secure-secrets.json');
  }

  async readEncryptedStore() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async writeEncryptedStore(store) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, this.filePath);
  }

  ensureEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Bộ lưu trữ bảo mật của hệ điều hành chưa sẵn sàng.');
    }
  }

  async set(name, value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) throw new Error('API key không được để trống.');
    if (normalized.length > 4096) throw new Error('API key không hợp lệ.');

    this.ensureEncryptionAvailable();
    const store = await this.readEncryptedStore();
    store[name] = safeStorage.encryptString(normalized).toString('base64');
    await this.writeEncryptedStore(store);
  }

  async get(name) {
    this.ensureEncryptionAvailable();
    const store = await this.readEncryptedStore();
    const encrypted = store[name];
    if (!encrypted) return null;

    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new Error('Không thể giải mã API key đã lưu trên thiết bị này.');
    }
  }

  async remove(name) {
    const store = await this.readEncryptedStore();
    if (!(name in store)) return;
    delete store[name];
    await this.writeEncryptedStore(store);
  }

  async status(name) {
    const value = await this.get(name);
    return {
      configured: Boolean(value),
      suffix: value ? value.slice(-4) : null
    };
  }
}

module.exports = { SecureSecretsService };
