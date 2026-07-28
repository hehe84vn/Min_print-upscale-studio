(() => {
  const $id = (id) => document.getElementById(id);
  const PROVIDER_KEY = 'aiEnhanceSelectedProvider';
  const FALLBACK_PRESETS = [
    { id: 'auto', label: 'Auto · ưu tiên bảo toàn', risk: 'auto', family: null, description: 'Tự chọn preset theo chữ/logo, mức tái tạo và độ phân giải nguồn.' },
    { id: 'print-faithful', label: 'Print Faithful · High Fidelity V3', risk: 'precise', family: 'topaz-standard', description: 'Mặc định cho ảnh in; ưu tiên bảo toàn bố cục và sản phẩm.' },
    { id: 'text-graphic', label: 'Text & Graphic · Text Refine', risk: 'precise', family: 'topaz-standard', description: 'Dành cho ảnh có chữ, logo, label hoặc graphic.' },
    { id: 'low-resolution', label: 'Low Resolution Restore · V2', risk: 'precise', family: 'topaz-standard', description: 'Dành cho ảnh nhỏ hoặc JPEG nén.' },
    { id: 'product-cgi', label: 'Product / CGI · CGI', risk: 'precise', family: 'topaz-standard', description: 'Dành cho render sản phẩm, mockup và CGI.' },
    { id: 'photo-standard', label: 'Photo Standard · Standard V2', risk: 'precise', family: 'topaz-standard', description: 'Upscale ảnh chụp thông thường.' },
    { id: 'restore-photo', label: 'Photo Recovery · Recovery V2', risk: 'generative', family: 'topaz-generative', description: 'Phục hồi ảnh xuống cấp; có thể tái tạo chi tiết.' },
    { id: 'detail-photo', label: 'Photo Detail · Detail', risk: 'generative', family: 'topaz-generative', description: 'Tăng chi tiết ảnh chụp với mức sáng tạo thấp.' },
    { id: 'creative-photo', label: 'Creative Photo · Krea Enhance', risk: 'creative', family: 'krea-enhance', description: 'Tạo thêm chi tiết; không dùng cho artwork approved.' },
    { id: 'creative-illustration', label: 'Creative Illustration · Topaz Bloom', risk: 'creative', family: 'topaz-bloom', description: 'Tái tạo texture minh họa; có thể làm đổi nội dung.' }
  ];
  const FAMILY_LIMITS = {
    'topaz-standard': 22000,
    'topaz-generative': 16000,
    'topaz-bloom': 10000,
    'krea-enhance': 8000
  };
  const kreaState = {
    configured: false,
    running: false,
    metadata: null,
    presets: [...FALLBACK_PRESETS]
  };

  function installStyles() {
    if ($id('kreaBetaSettingsStyles')) return;
    const style = document.createElement('style');
    style.id = 'kreaBetaSettingsStyles';
    style.textContent = `
      .krea-beta-settings-card{margin:14px 0;padding:14px;border:1px solid #7656a0;border-radius:12px;background:#171225}
      .krea-beta-settings-card h3{margin:0 0 4px;font-size:14px;color:#dfccff}.krea-beta-settings-card p{margin:0 0 12px;color:var(--muted);font-size:10px;line-height:1.45}
      .krea-beta-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}.krea-beta-status{display:block;margin-top:7px;font-size:10px;color:#9ba8ba}.krea-beta-status.ok{color:#85d9a0}.krea-beta-status.error{color:#ff9a9a}
      .krea-provider-note,.krea-model-warning{padding:9px;border-radius:8px;background:#21182e;border:1px solid #5e477d;color:#cdb9e9;font-size:10px;line-height:1.45;margin:8px 0 12px}.krea-model-warning{background:#2b2115;border-color:#8a6630;color:#f0cc8a}
      .krea-size-info{margin-top:8px;padding:9px 10px;border:1px solid #3b4658;border-radius:8px;color:#aeb9ca;font-size:10px;line-height:1.5}.krea-faithful-lock{padding:12px;border:1px solid #5d7d48;border-radius:10px;background:#172316;color:#bde5a4;font-size:11px;line-height:1.5}
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
    card.innerHTML = `<h3>Krea Cloud Beta</h3><p>Krea là cloud provider duy nhất của AI Enhance. API key được lưu bằng Secure Storage trên máy; file nguồn không bị ghi đè.</p><div class="setting-group"><label for="kreaBetaApiKeyInput">Krea API key</label><input id="kreaBetaApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Nhập Krea API key"/><small id="kreaBetaKeyStatus" class="krea-beta-status">Đang kiểm tra...</small></div><div class="krea-beta-actions"><button id="saveKreaBetaKeyBtn" class="primary" type="button">Lưu key</button><button id="testKreaBetaKeyBtn" class="secondary" type="button">Kiểm tra kết nối</button><button id="clearKreaBetaKeyBtn" class="danger-text" type="button">Xóa key</button></div>`;
    advanced.before(card);
  }

  function installProviderOption() {
    const provider = $id('jobProviderSelect');
    if (!provider) return;
    provider.querySelector('option[value="kiraai"]')?.remove();
    if (!provider.querySelector('option[value="krea"]')) {
      const option = document.createElement('option');
      option.value = 'krea';
      option.textContent = 'Krea Cloud Beta';
      provider.append(option);
    }
    if (localStorage.getItem(PROVIDER_KEY) === 'kiraai') localStorage.setItem(PROVIDER_KEY, 'krea');
  }

  function ensureExtraUi() {
    const modelGroup = $id('aiModelSelect')?.closest('.setting-group');
    if (!modelGroup) return;
    if (!$id('kreaProviderNote')) {
      const note = document.createElement('div');
      note.id = 'kreaProviderNote';
      note.className = 'krea-provider-note';
      note.hidden = true;
      modelGroup.insertAdjacentElement('afterend', note);
    }
    const modeGroup = document.querySelector('input[name="aiMode"]')?.closest('.setting-group');
    if (modeGroup && !$id('kreaFaithfulLock')) {
      const lock = document.createElement('div');
      lock.id = 'kreaFaithfulLock';
      lock.className = 'krea-faithful-lock';
      lock.hidden = true;
      lock.textContent = 'Krea preset đã khóa tham số ở mức bảo toàn phù hợp. Creative chỉ được bật khi chọn đúng preset creative.';
      modeGroup.insertAdjacentElement('afterend', lock);
    }
    if (modeGroup && !$id('kreaModelWarning')) {
      const warning = document.createElement('div');
      warning.id = 'kreaModelWarning';
      warning.className = 'krea-model-warning';
      warning.hidden = true;
      modeGroup.insertAdjacentElement('afterend', warning);
    }
    const sizeGroup = $id('aiSizeSetting');
    if (sizeGroup && !$id('kreaSizingInfo')) {
      const info = document.createElement('div');
      info.id = 'kreaSizingInfo';
      info.className = 'krea-size-info';
      info.hidden = true;
      sizeGroup.append(info);
    }
  }

  function renderKreaPresets() {
    const select = $id('aiModelSelect');
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    for (const preset of kreaState.presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      select.append(option);
    }
    select.value = kreaState.presets.some((preset) => preset.id === previous) ? previous : 'auto';
  }

  function selectedSizing() {
    const value = $id('aiImageSize')?.value || 'scale:2';
    return value.startsWith('long:')
      ? { targetLongEdge: Number(value.slice(5)) }
      : { scale: Number(value.replace('scale:', '')) || 2 };
  }

  function selectedMode() {
    return document.querySelector('input[name="aiMode"]:checked')?.value || 'safe';
  }

  function selectedPreset() {
    const id = $id('aiModelSelect')?.value || 'auto';
    return kreaState.presets.find((preset) => preset.id === id) || FALLBACK_PRESETS[0];
  }

  function modelMax(preset) {
    if (preset.id === 'auto') return 22000;
    return FAMILY_LIMITS[preset.family] || 8000;
  }

  async function updateSizingInfo() {
    const info = $id('kreaSizingInfo');
    if (!info || $id('jobProviderSelect')?.value !== 'krea') return;
    info.hidden = false;
    if (typeof state === 'undefined' || !state.inputPath) {
      info.textContent = 'Chọn ảnh để xem kích thước đầu ra dự kiến.';
      return;
    }
    try {
      kreaState.metadata = await window.studio.inspectImage(state.inputPath);
      const width = Number(kreaState.metadata?.width);
      const height = Number(kreaState.metadata?.height);
      if (!width || !height) throw new Error('Không đọc được kích thước ảnh.');
      const longEdge = Math.max(width, height);
      const sizing = selectedSizing();
      const requestedScale = sizing.targetLongEdge ? sizing.targetLongEdge / longEdge : sizing.scale;
      const maximum = modelMax(selectedPreset());
      const actualScale = Math.min(Math.max(1, requestedScale), 32, maximum / longEdge);
      const outW = Math.round(width * actualScale);
      const outH = Math.round(height * actualScale);
      const dpi = Number($id('dpiSelect')?.value) || 300;
      const cmW = (outW / dpi * 2.54).toFixed(1);
      const cmH = (outH / dpi * 2.54).toFixed(1);
      const limited = actualScale + 0.0001 < requestedScale ? ' · đã giới hạn theo model' : '';
      info.textContent = `Nguồn: ${width} × ${height}px · Đầu ra: ${outW} × ${outH}px · ${actualScale.toFixed(2)}×${limited} · In ${dpi} DPI: ${cmW} × ${cmH}cm`;
    } catch (error) {
      info.textContent = error.message || String(error);
    }
  }

  function syncPresetUi() {
    if ($id('jobProviderSelect')?.value !== 'krea') return;
    const preset = selectedPreset();
    const modeGroup = document.querySelector('input[name="aiMode"]')?.closest('.setting-group');
    if (modeGroup) modeGroup.hidden = true;
    if ($id('kreaFaithfulLock')) $id('kreaFaithfulLock').hidden = false;

    const note = $id('kreaProviderNote');
    if (note) note.textContent = preset.description || 'Krea sẽ xử lý bản RGB làm việc và app sẽ chuẩn hóa kích thước đầu ra.';

    const warning = $id('kreaModelWarning');
    if (warning) {
      warning.hidden = preset.risk !== 'generative' && preset.risk !== 'creative';
      warning.textContent = preset.risk === 'creative'
        ? 'Cảnh báo: preset creative có thể thay đổi chữ, logo, texture và hình dạng. Không dùng cho artwork approved.'
        : 'Cảnh báo: preset generative có thể tái tạo chi tiết không có trong ảnh nguồn. Cần kiểm tra crop 100% trước khi in.';
    }
    updateSizingInfo();
  }

  function syncProviderUi() {
    const isKrea = $id('jobProviderSelect')?.value === 'krea';
    if (isKrea) renderKreaPresets();
    if ($id('kreaProviderNote')) $id('kreaProviderNote').hidden = !isKrea;
    if ($id('kreaSizingInfo')) $id('kreaSizingInfo').hidden = !isKrea;

    const modelLabel = $id('aiModelSelect')?.closest('.setting-group')?.querySelector('label');
    if (modelLabel) modelLabel.textContent = isKrea ? 'Krea preset' : 'AI model';
    const sizeLabel = $id('aiSizeSetting')?.querySelector('label');
    if (sizeLabel) sizeLabel.textContent = isKrea ? 'Kích thước đầu ra Krea' : 'Độ phân giải AI';
    const sizeSelect = $id('aiImageSize');
    if (sizeSelect && isKrea) {
      sizeSelect.innerHTML = [
        ['scale:2', '2× · khuyến nghị test đầu tiên'],
        ['scale:4', '4×'],
        ['long:4000', '4K · cạnh dài 4.000px'],
        ['long:8000', '8K · cạnh dài 8.000px'],
        ['long:12000', '12K · cạnh dài 12.000px'],
        ['long:16000', '16K · cạnh dài 16.000px'],
        ['long:22000', '22K · tối đa Print Faithful']
      ].map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    }
    const formatLabel = $id('formatSetting')?.querySelector('label');
    if (formatLabel) formatLabel.textContent = isKrea ? 'Định dạng RGB Master' : 'Định dạng RGB Master';
    if ($id('runBtn') && typeof state !== 'undefined' && state.tool === 'ai-enhance') {
      $id('runBtn').textContent = isKrea ? 'Tăng cường bằng Krea' : 'Tăng cường bằng AI';
    }

    if (isKrea) syncPresetUi();
    else {
      const modeGroup = document.querySelector('input[name="aiMode"]')?.closest('.setting-group');
      if (modeGroup) modeGroup.hidden = false;
      if ($id('kreaFaithfulLock')) $id('kreaFaithfulLock').hidden = true;
      if ($id('kreaModelWarning')) $id('kreaModelWarning').hidden = true;
    }
  }

  function renderStatus(status, message = '') {
    const label = $id('kreaBetaKeyStatus');
    if (!label) return;
    label.classList.remove('ok', 'error');
    kreaState.configured = Boolean(status?.configured);
    if (Array.isArray(status?.presets) && status.presets.length) {
      kreaState.presets = status.presets;
      if ($id('jobProviderSelect')?.value === 'krea') renderKreaPresets();
    }
    label.textContent = message || (status?.configured
      ? `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}`
      : 'Chưa lưu API key');
    if (status?.configured && !message) label.classList.add('ok');
    if ($id('testKreaBetaKeyBtn')) $id('testKreaBetaKeyBtn').disabled = !status?.configured;
    if ($id('clearKreaBetaKeyBtn')) $id('clearKreaBetaKeyBtn').disabled = !status?.configured;
  }

  async function loadStatus() {
    try {
      renderStatus(await window.studio.getKreaBetaStatus());
      syncProviderUi();
    } catch (error) {
      renderStatus(null, error.message || String(error));
      $id('kreaBetaKeyStatus')?.classList.add('error');
    }
  }

  async function saveKey() {
    const input = $id('kreaBetaApiKeyInput');
    const key = input?.value.trim() || '';
    if (!key) {
      renderStatus(null, 'Hãy nhập Krea API key trước khi lưu.');
      return;
    }
    try {
      const status = await window.studio.saveKreaBetaKey(key);
      input.value = '';
      renderStatus(status);
    } catch (error) {
      renderStatus(null, error.message || String(error));
    }
  }

  async function testConnection() {
    if ($id('kreaBetaApiKeyInput')?.value.trim()) await saveKey();
    try {
      await window.studio.testKreaBetaConnection();
      const status = await window.studio.getKreaBetaStatus();
      renderStatus(status, 'Kết nối Krea thành công.');
    } catch (error) {
      renderStatus(null, error.message || String(error));
    }
  }

  async function clearKey() {
    if (!window.confirm('Xóa Krea API key đã lưu trên máy này?')) return;
    try {
      renderStatus(await window.studio.clearKreaBetaKey());
    } catch (error) {
      renderStatus(null, error.message || String(error));
    }
  }

  async function runKreaAsProvider(event) {
    if ($id('jobProviderSelect')?.value !== 'krea' || typeof state === 'undefined' || state.tool !== 'ai-enhance') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (kreaState.running || !state.inputPath) return;

    if (!kreaState.configured) {
      await openSettings();
      $id('resultBox').classList.add('error');
      $id('resultBox').textContent = 'Chưa có API key Krea.';
      $id('resultBox').hidden = false;
      return;
    }
    if (!state.outputPath) await chooseOutput();
    if (!state.outputPath) return;

    kreaState.running = true;
    $id('runBtn').disabled = true;
    $id('progressWrap').hidden = false;
    $id('resultBox').hidden = true;
    $id('progressBar').style.width = '5%';
    $id('progressText').textContent = 'Đang kiểm tra ảnh đầu vào...';

    try {
      const result = await window.studio.runKreaBetaEnhance({
        inputPath: state.inputPath,
        outputPath: state.outputPath,
        options: {
          presetId: $id('aiModelSelect').value,
          ...selectedSizing(),
          regenerationMode: selectedMode(),
          prompt: $id('customPrompt').value,
          protectFace: $id('protectFace').checked,
          protectText: $id('protectText').checked,
          protectLogo: $id('protectLogo').checked,
          preserveColor: $id('preserveColor').checked,
          dpi: Number($id('dpiSelect').value) || 300,
          outputFormat: $id('formatSelect').value
        }
      });
      const output = result.output;
      const warning = Array.isArray(result.warnings) && result.warnings.length ? ` · Cảnh báo: ${result.warnings.join(' ')}` : '';
      $id('progressBar').style.width = '100%';
      $id('progressText').textContent = 'Krea đã hoàn tất và hậu kiểm kích thước.';
      $id('resultBox').classList.remove('error');
      $id('resultBox').textContent = `Đã lưu ${result.presetLabel}: ${output.width} × ${output.height}px · ${String(output.format).toUpperCase()} · ${output.density} DPI · ${Math.round(output.sizeBytes / 1024)} KB${warning}`;
      $id('resultBox').hidden = false;
      await showComparison(result.outputPath);
    } catch (error) {
      $id('resultBox').classList.add('error');
      $id('resultBox').textContent = error.message || String(error);
      $id('resultBox').hidden = false;
    } finally {
      kreaState.running = false;
      $id('runBtn').disabled = !state.inputPath;
    }
  }

  installStyles();
  installSettingsCard();
  installProviderOption();
  ensureExtraUi();
  $id('saveKreaBetaKeyBtn')?.addEventListener('click', saveKey);
  $id('testKreaBetaKeyBtn')?.addEventListener('click', testConnection);
  $id('clearKreaBetaKeyBtn')?.addEventListener('click', clearKey);
  $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  $id('jobProviderSelect')?.addEventListener('change', () => {
    localStorage.setItem(PROVIDER_KEY, $id('jobProviderSelect').value);
    syncProviderUi();
  });
  $id('aiImageSize')?.addEventListener('change', updateSizingInfo);
  $id('dpiSelect')?.addEventListener('change', updateSizingInfo);
  $id('aiModelSelect')?.addEventListener('change', syncPresetUi);
  $id('runBtn')?.addEventListener('click', runKreaAsProvider, true);

  if (typeof window.selectTool === 'function') {
    const original = window.selectTool;
    window.selectTool = function selectToolWithKrea(tool) {
      original(tool);
      if (tool === 'ai-enhance' && localStorage.getItem(PROVIDER_KEY) === 'krea') $id('jobProviderSelect').value = 'krea';
      syncProviderUi();
    };
  }

  window.studio.onKreaBetaProgress?.((progress) => {
    if (!kreaState.running) return;
    if (progress?.message) $id('progressText').textContent = progress.message;
    const map = { preparing: 12, uploading: 20, backlogged: 28, queued: 35, scheduled: 42, processing: 65, sampling: 72, 'intermediate-complete': 82, exporting: 90, completed: 100 };
    if (map[progress?.status]) $id('progressBar').style.width = `${map[progress.status]}%`;
  });

  loadStatus();
  if (localStorage.getItem(PROVIDER_KEY) === 'krea') $id('jobProviderSelect').value = 'krea';
  syncProviderUi();
})();
