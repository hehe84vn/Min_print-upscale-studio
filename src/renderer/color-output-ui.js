(() => {
  const colorState = {
    settings: null,
    customProfilePath: null
  };

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
      .color-settings-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    `;
    document.head.append(style);
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
          <select id="jobColorProfile">
            <option value="iso-coated-v2">ISO Coated v2 (ECI)</option>
            <option value="pso-coated-v3">PSO Coated v3 (FOGRA51)</option>
            <option value="pso-uncoated-v3">PSO Uncoated v3 (FOGRA52)</option>
            <option value="custom">Custom ICC</option>
          </select>
        </div>
      </div>
      <p class="color-output-note">AI luôn xử lý RGB. CMYK được tạo sau cùng dưới dạng TIFF 8-bit, LZW và nhúng ICC. Đây là production copy để designer tiếp tục kiểm tra, không phải file in đã preflight hoàn chỉnh.</p>
    `;
    outputRow.before(card);
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
          <select id="defaultColorProfile">
            <option value="iso-coated-v2">ISO Coated v2 (ECI)</option>
            <option value="pso-coated-v3">PSO Coated v3 (FOGRA51)</option>
            <option value="pso-uncoated-v3">PSO Uncoated v3 (FOGRA52)</option>
            <option value="custom">Custom ICC</option>
          </select>
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
      <p class="color-output-note">Relative Colorimetric và BPC được lưu như yêu cầu workflow. Engine chuyển đổi hiện dùng ICC transform của libvips/Sharp; designer vẫn phải kiểm tra separation, TAC, black, spot color và proof.</p>
      <div class="color-settings-actions"><button id="saveColorSettingsBtn" class="primary" type="button">Lưu Color Output</button></div>
    `;
    advanced.before(card);
  }

  function renameQualityCheck() {
    const toggle = $('preflightEnabled')?.closest('label');
    const label = toggle?.querySelector('span');
    if (label) label.textContent = 'Upscale Quality Check';
    const labNotice = document.querySelector('#benchmarkSettings .lab-notice');
    if (labNotice) {
      labNotice.innerHTML = '<b>Packaging Safe Pro · Upscale Quality Check</b><span>Kiểm tra lỗi do upscale trong RGB: QR/barcode, màu tương đối, hình học, text/logo, halo và mức phủ mask. Không thay thế preflight CMYK cuối.</span>';
    }
  }

  function syncJobVisibility() {
    if (!$('colorOutputJobCard')) return;
    $('colorOutputJobCard').hidden = ['vector-logo', 'model-lab'].includes(state.tool);
  }

  function renderSettings(summary) {
    colorState.settings = summary.settings;
    colorState.customProfilePath = summary.settings.customProfilePath || null;
    $('defaultColorOutputMode').value = summary.settings.outputMode;
    $('defaultColorProfile').value = summary.settings.profileId;
    $('defaultRenderingIntent').value = summary.settings.renderingIntent;
    $('defaultBlackPointCompensation').checked = summary.settings.blackPointCompensation;
    $('customIccPath').textContent = colorState.customProfilePath || 'Chưa chọn custom profile';
    $('jobColorOutputMode').value = summary.settings.outputMode;
    $('jobColorProfile').value = summary.settings.profileId;
  }

  async function loadColorSettings() {
    try {
      renderSettings(await window.studio.getColorSettings());
    } catch (error) {
      console.error('Color Output settings:', error);
    }
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
      renderSettings(await window.studio.saveColorSettings(payload));
      setAiSettingsMessage('Đã lưu Color Output & ICC Management.');
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
  installSettingsControls();
  renameQualityCheck();
  document.title = 'Print Upscale Studio V2.5 Color Output';
  const brandVersion = document.querySelector('.brand span');
  if (brandVersion) brandVersion.textContent = 'Studio V2.5 · Color Output';

  const originalSelectTool = window.selectTool;
  if (typeof originalSelectTool === 'function') {
    window.selectTool = function selectToolWithColorOutput(tool) {
      originalSelectTool(tool);
      syncJobVisibility();
    };
  }

  $('chooseCustomIccBtn').addEventListener('click', chooseCustomProfile);
  $('saveColorSettingsBtn').addEventListener('click', saveColorSettings);
  $('appSettingsBtn').addEventListener('click', loadColorSettings);
  loadColorSettings();
  syncJobVisibility();
  replaceRunHandler();
})();
