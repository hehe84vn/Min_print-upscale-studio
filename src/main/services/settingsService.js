const fs = require('node:fs/promises');
const path = require('node:path');

class SettingsService {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'settings.json');
  }

  async read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async write(patch) {
    const current = await this.read();
    const next = { ...current, ...patch };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  async clearEngine() {
    const current = await this.read();
    delete current.engineBinary;
    delete current.modelsDirectory;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(current, null, 2), 'utf8');
    return current;
  }
}

module.exports = { SettingsService };
