(() => {
  const colorState = {
    settings: null,
    customProfilePath: null,
    storageSettings: null
  };

  function humanBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (typeof formatBytes === 'function') return formatBytes(value);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function installStyles() {
    if ($('colorOutputStyles')) return;
    const style = document.createElement('style');
    style.id = 'colorOutputStyles';
    style.textContent = `
      .color-output-card { margin: 14px 0; padding: 12px; border: 1px solid #425477; border-radius: 11px; background: #121923; }
      .color-output-card > strong { display: block; color: #bcd5ff; font-size: 12px; margin-bottom: 9px; }
      .color-output-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
      .color-output-note { color: #8f9bad; font-size: 10px; line-height: 1.45; margin: 8px 0 0; }
      .color-settings-card { margin: 14px 0; padding: 14px; border: 1px solid #425477; border-radius: 12px; background: #111923; }
      .color-settings-card h3 { margin: 0 0 4px; font-size: 14px; }
      .color-settings-card > p { margin: 0 0 12px; color: var(--muted); font-size: 10px; line-height: 1.45; }
      .profile-path { display: block; margin-top: 6px; color: #93a2b5; font-size: 9px; word-break: break-all; }
      .color-settings-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      .storage-status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
      .storage-status-grid div { padding: 9px; border-radius: 8px; background: #0d131b; border: 1px solid #293647; }
      .storage-status-grid small { display: block; color: #78869a; font-size: 8px; letter-spacing: .05em; }
      .storage-status-grid strong { display: block; margin-top: 4px; font-size: 11px; color: #d8e5f9; }
      .model-lab-color-card { border-color: #566da0; background: #121927; }
    `;
    document.head.append(style);
  }

  function profileOptions() {
    return `
      <option value="iso-coated-v2">ISO Coated v2 (ECI)</option>
      <option value="pso-coated-v3">PSO Coated v3 (FOGRA51)</option>
      <option value="pso-uncoated-v3">PSO Uncoated v3 (FOGRA52)</option>
      <option value="custom">Custom ICC</option>
    `;
  }

  function installJobControls() {
    if ($('colorOutputJobCard')) return;
    const outputRow = document.querySelector('.output-row');
    if (!outputRow) return;
    const card = document.createElement('section');
    card.id = 'colorOutputJobCard';
    card.className = 'color-output-card';
    card.innerHTML = `
      <strong>Color Output</strong>
      <div class="color-output-grid">
        <div class="setting-group">
          <label for="jobColorOutputMode">Output mode</label>
          <select id="jobColorOutputMode">
            <option value="rgb-only">RGB Master only</option>
            <option value="rgb-cmyk">RGB Master + CMYK Copy</option>
            <option value="cmyk-only">CMYK Copy only</option>
          </select>
        </div>
        <div class="setting-group">
          <label for="jobColorProfile">CMYK profile</label>
          <select id="jobColorProfile">${profileOptions()}</select>
        </div>
      </div>
      <p class="color-output-note">AI luôn xử lý RGB. CMYK được tạo sau cùng dưới dạng TIFF 8-bit, LZW và nhúng ICC. Đây là production copy để designer tiếp tục kiểm tra.</p>
    `;
    outputRow.before(card);
  }

  function installModelLabColorControls() {
    if ($('modelLabColorOutputControls')) return;
    const qualityToggle = $('preflightEnabled')?.closest('label');
    if (!qualityToggle) return;
    const card = document.createElement('section');
    card.id = 'modelLabColorOutputControls';
    card.className = 'color-output-card model-lab-color-card';
    card.innerHTML = `
      <strong>Model Lab Color Output</strong>
      <label class="check-row"><input id="modelLabCmykEnabled" type="checkbox" /><span>Xuất thêm CMYK TIFF cho từng kết quả model</span></label>
      <div class="setting-group">
        <label for="modelLabColorProfile">CMYK profile</label>
        <select id="modelLabColorProfile">${profileOptions()}</select>
      </div>
      <p class="color-output-note">Model Lab luôn giữ PNG RGB để so sánh A/B. Khi bật, mỗi kết quả sẽ có thêm một TIFF CMYK, vì vậy dung lượng phiên có thể tăng đáng kể.</p>
    `;
    qualityToggle.insertAdjacentElement('afterend', card);
  }

  function installSettingsControls() {
    if ($('colorOutputSettingsCard')) return;
    const advanced = document.querySelector('.advanced-details');
    if (!advanced) return;
    const card = document.createElement('section');
    card.id = 'colorOutputSettingsCard';
    card.className = 'color-settings-card';
    card.innerHTML = `
      <h3>Color Output & ICC Management</h3>
      <p>Cấu hình mặc định cho RGB master và CMYK production copy. AI vẫn xử lý hoàn toàn trong RGB.</p>
      <div class="color-output-grid">
        <div class="setting-group">
          <label for="defaultColorOutputMode">Output mặc định</label>
          <select id="defaultColorOutputMode">
            <option value="rgb-only">RGB Master only</option>
            <option value="rgb-cmyk">RGB Master + CMYK Copy</option>
            <option value="cmyk-only">CMYK Copy only</option>
          </select>
        </div>
        <div class="setting-group">
          <label for="defaultColorProfile">CMYK profile mặc định</label>
          <select id="defaultColorProfile">${profileOptions()}</select>
        </div>
        <div class="setting-group">
          <label for="defaultRenderingIntent">Rendering intent</label>
          <select id="defaultRenderingIntent">
            <option value="relative">Relative Colorimetric</option>
            <option value="perceptual">Perceptual</option>
          </select>
        </div>
        <div class="setting-group">
          <label>TIFF output</label>
          <select disabled><option>8-bit · LZW · Embed ICC</option></select>
        </div>
      </div>
      <label class="check-row"><input id="defaultBlackPointCompensation" type="checkbox" checked /><span>Black Point Compensation</span></label>
      <button id="chooseCustomIccBtn" class="secondary wide" type="button">Chọn ICC profile của nhà in</button>
      <small id="customIccPath" class="profile-path">Chưa chọn custom profile</small>
      <p class="color-output-note">Designer vẫn phải kiểm tra separation, TAC, black, spot color, overprint và proof.</p>
      <div class="color-settings-actions"><button id="saveColorSettingsBtn" class="primary" type="button">Lưu Color Output</button></div>
    `;
    advanced.before(card);
  }

  function installStorageControls() {
    if ($('storageHygieneSettingsCard')) return;
    const advanced = document.querySelector('.advanced-details');
    if (!advanced) return;
    const card = document.createElement('section');
    card.id = 'storageHygieneSettingsCard';
    card.className = 'color-settings-card';
    card.innerHTML = `
      <h3>Storage & Performance</h3>
      <p>Chỉ quản lý temp do Print Upscale Studio tạo và cache Chromium của chính ứng dụng. Không xóa output hoặc thư mục Model Lab mà người dùng đã chọn.</p>
      <div class="storage-status-grid">
        <div><small>APP TEMP</small><strong id="storageTempStatus">—</strong></div>
        <div><small>CHROMIUM CACHE</small><strong id="storageCacheStatus">—</strong></div>
        <div><small>SHARP CACHE</small><strong id="storageSharpStatus">—</strong></div>
      </div>
      <label class="check-row"><input id="autoCleanupTemp" type="checkbox" checked /><span>Tự dọn temp cũ khi khởi động</span></label>
      <div class="setting-group">
        <label for="tempRetentionHours">Chỉ xóa temp cũ hơn</label>
        <select id="tempRetentionHours">
          <option value="6">6 giờ</option>
          <option value="12">12 giờ</option>
          <option value="24">24 giờ</option>
          <option value="48">48 giờ</option>
          <option value="72">72 giờ</option>
          <option value="168">7 ngày</option>
        </select>
      </div>
      <div class="color-settings-actions">
        <button id="refreshStorageStatusBtn" class="secondary" type="button">Làm mới</button>
        <button id="cleanupOldTempBtn" class="secondary" type="button">Dọn temp cũ</button>
        <button id="clearAppCacheBtn" class="danger-text" type="button">Xóa toàn bộ temp & cache</button>
        <button id="saveStorageSettingsBtn" class="primary" type="button">Lưu</button>
      </div>
    `;
    advanced.before(card);
  }

  function renameQualityCheck() {
    const toggle = $('preflightEnabled')?.closest('label');
    const label = toggle?.querySelector('span');
    if (label) label.textContent = 'Upscale Quality Check';
    const labNotice = document.querySelector('#benchmarkSettings .lab-notice');
    if (labNotice) {
      labNotice.innerHTML = '<b>Packaging Safe Pro · Upscale Quality Check</b><span>Kiểm tra lỗi do upscale trong RGB. Không thay thế preflight CMYK cuối.</span>';
    }
  }

  function syncJobVisibility() {
    if (!$('colorOutputJobCard')) return;
    $('colorOutputJobCard').hidden = ['vector-logo', 'model-lab'].includes(state.tool);
  }

  function renderColorSettings(summary) {
    colorState.settings = summary.settings;
    colorState.customProfilePath = summary.settings.customProfilePath || null;
    $('defaultColorOutputMode').value = summary.settings.outputMode;
    $('defaultColorProfile').value = summary.settings.profileId;
    $('defaultRenderingIntent').value = summary.settings.renderingIntent;
    $('defaultBlackPointCompensation').checked = summary.settings.blackPointCompensation;
    $('customIccPath').textContent = colorState.customProfilePath || 'Chưa chọn custom profile';
    $('jobColorOutputMode').value = summary.settings.outputMode;
    $('jobColorProfile').value = summary.settings.profileId;
    $('modelLabColorProfile').value = summary.settings.profileId;
  }

  function renderStorage(summary) {
    const settings = summary.settings || colorState.storageSettings || { autoCleanupTemp: true, tempRetentionHours: 24 };
    const status = summary.status || summary;
    colorState.storageSettings = settings;
    $('autoCleanupTemp').checked = settings.autoCleanupTemp !== false;
    $('tempRetentionHours').value = String(settings.tempRetentionHours || 24);
    $('storageTempStatus').textContent = `${status.tempCount ?? 0} mục · ${humanBytes(status.tempBytes ?? 0)}`;
    $('storageCacheStatus').textContent = humanBytes(status.chromiumCacheBytes);
    const sharpMemory = status.sharpCache?.memory?.current ?? status.sharpCache?.memory?.max;
    $('storageSharpStatus').textContent = sharpMemory == null ? 'đã giới hạn' : `${sharpMemory} MB`;
  }

  async function loadColorSettings() {
    try { renderColorSettings(await window.studio.getColorSettings()); }
    catch (error) { console.error('Color Output settings:', error); }
  }

  async function loadStorageSettings() {
    try { renderStorage(await window.studio.getStorageSettings()); }
    catch (error) { console.error('Storage settings:', error); }
  }

  async function saveColorSettings() {
    const payload = {
      outputMode: $('defaultColorOutputMode').value,
      profileId: $('defaultColorProfile').value,
      customProfilePath: colorState.customProfilePath,
      renderingIntent: $('defaultRenderingIntent').value,
      blackPointCompensation: $('defaultBlackPointCompensation').checked,
      compression: 'lzw',
      bitDepth: 8,
      embedProfile: true
    };
    try {
      renderColorSettings(await window.studio.saveColorSettings(payload));
      setAiSettingsMessage('Đã lưu Color Output & ICC Management.');
    } catch (error) {
      setAiSettingsMessage(error.message || String(error), true);
    }
  }

  async function saveStorageSettings() {
    try {
      renderStorage(await window.studio.saveStorageSettings({
        autoCleanupTemp: $('autoCleanupTemp').checked,
        tempRetentionHours: Number($('tempRetentionHours').value)
      }));
      setAiSettingsMessage('Đã lưu Storage & Performance.');
    } catch (error) {
      setAiSettingsMessage(error.message || String(error), true);
    }
  }

  async function chooseCustomProfile() {
    const profilePath = await window.studio.selectIccProfile();
    if (!profilePath) return;
    colorState.customProfilePath = profilePath;
    $('customIccPath').textContent = profilePath;
    $('defaultColorProfile').value = 'custom';
    $('jobColorProfile').value = 'custom';
    $('modelLabColorProfile').value = 'custom';
  }

  async function refreshStorageStatus() {
    try { renderStorage({ settings: colorState.storageSettings, status: await window.studio.getStorageStatus() }); }
    catch (error) { setAiSettingsMessage(error.message || String(error), true); }
  }

  async function cleanupOldTemp() {
    try {
      const response = await window.studio.cleanupTemp({ olderThanHours: Number($('tempRetentionHours').value) });
      renderStorage({ settings: colorState.storageSettings, status: response.status });
      setAiSettingsMessage(`Đã xóa ${response.result.removedCount} mục temp, giải phóng ${humanBytes(response.result.removedBytes)}.`);
    } catch (error) {
      setAiSettingsMessage(error.message || String(error), true);
    }
  }

  async function clearAllAppCache() {
    if (!window.confirm('Xóa toàn bộ temp của Print Upscale Studio và cache Chromium của app? Output đã lưu sẽ không bị xóa.')) return;
    try {
      const response = await window.studio.clearAppCache();
      renderStorage({ settings: colorState.storageSettings, status: response.status });
      setAiSettingsMessage(`Đã xóa cache và giải phóng ${humanBytes(response.result.temp.removedBytes)} temp.`);
    } catch (error) {
      setAiSettingsMessage(error.message || String(error), true);
    }
  }

  async function createCmykAfterRgb(rgbPath) {
    if (!rgbPath || ['vector-logo', 'model-lab'].includes(state.tool)) return null;
    const outputMode = $('jobColorOutputMode').value;
    if (outputMode === 'rgb-only') return null;
    const profileId = $('jobColorProfile').value;
    if (profileId === 'custom' && !colorState.customProfilePath) {
      throw new Error('Chưa chọn Custom ICC profile trong Settings.');
    }
    return window.studio.convertToCmyk({
      inputPath: rgbPath,
      dpi: Number($('dpiSelect').value) || 300,
      settings: {
        ...(colorState.settings || {}),
        outputMode,
        profileId,
        customProfilePath: colorState.customProfilePath
      }
    });
  }

  function replaceRunHandler() {
    const button = $('runBtn');
    const originalRun = window.run;
    if (!button || typeof originalRun !== 'function' || window.__colorOutputRunInstalled) return;
    button.removeEventListener('click', originalRun);
    window.__colorOutputRunInstalled = true;
    button.addEventListener('click', async () => {
      await originalRun();
      if ($('resultBox').classList.contains('error') || state.tool === 'model-lab' || state.tool === 'vector-logo') return;
      try {
        const cmyk = await createCmykAfterRgb(state.outputPath);
        if (!cmyk) return;
        const mode = $('jobColorOutputMode').value;
        $('resultBox').classList.remove('error');
        $('resultBox').textContent = mode === 'cmyk-only'
          ? `Đã lưu CMYK TIFF: ${cmyk.outputPath}`
          : `Đã lưu RGB Master: ${state.outputPath}\nCMYK Copy: ${cmyk.outputPath}`;
      } catch (error) {
        $('resultBox').classList.add('error');
        $('resultBox').textContent = `RGB đã xử lý nhưng không tạo được CMYK copy: ${error.message || error}`;
      }
    });
  }

  installStyles();
  installJobControls();
  installModelLabColorControls();
  installSettingsControls();
  installStorageControls();
  renameQualityCheck();
  document.title = 'Print Upscale Studio V2.6 Storage & Model Lab CMYK';
  const brandVersion = document.querySelector('.brand span');
  if (brandVersion) brandVersion.textContent = 'Studio V2.6 · Storage + CMYK';

  const originalSelectTool = window.selectTool;
  if (typeof originalSelectTool === 'function') {
    window.selectTool = function selectToolWithColorOutput(tool) {
      originalSelectTool(tool);
      syncJobVisibility();
    };
  }

  $('chooseCustomIccBtn').addEventListener('click', chooseCustomProfile);
  $('saveColorSettingsBtn').addEventListener('click', saveColorSettings);
  $('saveStorageSettingsBtn').addEventListener('click', saveStorageSettings);
  $('refreshStorageStatusBtn').addEventListener('click', refreshStorageStatus);
  $('cleanupOldTempBtn').addEventListener('click', cleanupOldTemp);
  $('clearAppCacheBtn').addEventListener('click', clearAllAppCache);
  $('appSettingsBtn').addEventListener('click', () => {
    loadColorSettings();
    loadStorageSettings();
  });

  loadColorSettings();
  loadStorageSettings();
  syncJobVisibility();
  replaceRunHandler();
})();
