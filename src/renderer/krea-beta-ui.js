(() => {
  const $id = (id) => document.getElementById(id);

  function installStyles() {
    if ($id('kreaBetaSettingsStyles')) return;
    const style = document.createElement('style');
    style.id = 'kreaBetaSettingsStyles';
    style.textContent = `
      .krea-beta-settings-card { margin: 14px 0; padding: 14px; border: 1px solid #7656a0; border-radius: 12px; background: #171225; }
      .krea-beta-settings-card h3 { margin: 0 0 4px; font-size: 14px; color: #dfccff; }
      .krea-beta-settings-card p { margin: 0 0 12px; color: var(--muted); font-size: 10px; line-height: 1.45; }
      .krea-beta-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 10px; }
      .krea-beta-status { display: block; margin-top: 7px; font-size: 10px; color: #9ba8ba; }
      .krea-beta-status.ok { color: #85d9a0; }
      .krea-beta-status.error { color: #ff9a9a; }
    `;
    document.head.append(style);
  }

  function installSettingsCard() {
    if ($id('kreaBetaSettingsCard')) return;
    const advanced = document.querySelector('.advanced-details');
    if (!advanced) return;

    const card = document.createElement('section');
    card.id = 'kreaBetaSettingsCard';
    card.className = 'krea-beta-settings-card';
    card.innerHTML = `
      <h3>Krea AI Beta</h3>
      <p>Module thử nghiệm riêng. API key chỉ được lưu bằng bộ lưu trữ bảo mật của macOS hoặc Windows. Ảnh chỉ được gửi tới Krea khi bạn chủ động chạy tính năng Krea Beta.</p>
      <div class="setting-group">
        <label for="kreaBetaApiKeyInput">Krea API key</label>
        <input id="kreaBetaApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Tự nhập Krea API key tại đây" />
        <small id="kreaBetaKeyStatus" class="krea-beta-status">Đang kiểm tra...</small>
      </div>
      <div class="krea-beta-actions">
        <button id="saveKreaBetaKeyBtn" class="primary" type="button">Lưu key</button>
        <button id="testKreaBetaKeyBtn" class="secondary" type="button">Kiểm tra kết nối</button>
        <button id="clearKreaBetaKeyBtn" class="danger-text" type="button">Xóa key</button>
      </div>
    `;
    advanced.before(card);
  }

  function renderStatus(status, message = '') {
    const label = $id('kreaBetaKeyStatus');
    if (!label) return;
    label.classList.remove('ok', 'error');
    if (message) {
      label.textContent = message;
      return;
    }
    if (status?.configured) {
      label.textContent = `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}`;
      label.classList.add('ok');
    } else {
      label.textContent = 'Chưa lưu API key';
    }
    $id('testKreaBetaKeyBtn').disabled = !status?.configured;
    $id('clearKreaBetaKeyBtn').disabled = !status?.configured;
  }

  async function loadStatus() {
    try {
      renderStatus(await window.studio.getKreaBetaStatus());
    } catch (error) {
      renderStatus(null, error.message || String(error));
      $id('kreaBetaKeyStatus')?.classList.add('error');
    }
  }

  async function saveKey() {
    const input = $id('kreaBetaApiKeyInput');
    const apiKey = input?.value.trim() || '';
    if (!apiKey) {
      renderStatus(null, 'Hãy nhập Krea API key trước khi lưu.');
      $id('kreaBetaKeyStatus')?.classList.add('error');
      return;
    }
    renderStatus(null, 'Đang lưu API key...');
    try {
      const status = await window.studio.saveKreaBetaKey(apiKey);
      input.value = '';
      renderStatus(status);
    } catch (error) {
      renderStatus(null, error.message || String(error));
      $id('kreaBetaKeyStatus')?.classList.add('error');
    }
  }

  async function testConnection() {
    const pending = $id('kreaBetaApiKeyInput')?.value.trim();
    if (pending) await saveKey();
    renderStatus(null, 'Đang kiểm tra kết nối Krea...');
    try {
      await window.studio.testKreaBetaConnection();
      const status = await window.studio.getKreaBetaStatus();
      renderStatus(status, `Kết nối Krea thành công · key kết thúc bằng ${status.suffix || '••••'}`);
      $id('kreaBetaKeyStatus')?.classList.add('ok');
    } catch (error) {
      renderStatus(null, error.message || String(error));
      $id('kreaBetaKeyStatus')?.classList.add('error');
    }
  }

  async function clearKey() {
    if (!window.confirm('Xóa Krea API key đã lưu trên máy này?')) return;
    try {
      renderStatus(await window.studio.clearKreaBetaKey());
      $id('kreaBetaApiKeyInput').value = '';
    } catch (error) {
      renderStatus(null, error.message || String(error));
      $id('kreaBetaKeyStatus')?.classList.add('error');
    }
  }

  installStyles();
  installSettingsCard();
  $id('saveKreaBetaKeyBtn')?.addEventListener('click', saveKey);
  $id('testKreaBetaKeyBtn')?.addEventListener('click', testConnection);
  $id('clearKreaBetaKeyBtn')?.addEventListener('click', clearKey);
  $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  loadStatus();
})();