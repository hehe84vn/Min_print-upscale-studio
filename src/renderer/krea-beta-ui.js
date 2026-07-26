(() => {
  const $id = (id) => document.getElementById(id);
  const KREA_MODELS = [
    ['topaz', 'Topaz · Faithful'],
    ['topaz-generative', 'Topaz Generative · Detail'],
    ['topaz-bloom', 'Topaz Bloom · Creative'],
    ['krea-enhance', 'Krea Enhance · Budget Creative']
  ];
  const PROVIDER_KEY = 'aiEnhanceSelectedProvider';
  const kreaState = { configured: false, running: false };

  function installStyles() {
    if ($id('kreaBetaSettingsStyles')) return;
    const style = document.createElement('style');
    style.id = 'kreaBetaSettingsStyles';
    style.textContent = `
      .krea-beta-settings-card{margin:14px 0;padding:14px;border:1px solid #7656a0;border-radius:12px;background:#171225}
      .krea-beta-settings-card h3{margin:0 0 4px;font-size:14px;color:#dfccff}
      .krea-beta-settings-card p{margin:0 0 12px;color:var(--muted);font-size:10px;line-height:1.45}
      .krea-beta-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}
      .krea-beta-status{display:block;margin-top:7px;font-size:10px;color:#9ba8ba}.krea-beta-status.ok{color:#85d9a0}.krea-beta-status.error{color:#ff9a9a}
      .krea-provider-note{padding:9px;border-radius:8px;background:#21182e;border:1px solid #5e477d;color:#cdb9e9;font-size:10px;line-height:1.45;margin:8px 0 12px}
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
      <p>Krea hoạt động như một nhà cung cấp độc lập trong AI Enhance, tương tự Gemini và OpenAI. Chỉ cần nhập API key tại đây.</p>
      <div class="setting-group"><label for="kreaBetaApiKeyInput">Krea API key</label><input id="kreaBetaApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Tự nhập Krea API key tại đây" /><small id="kreaBetaKeyStatus" class="krea-beta-status">Đang kiểm tra...</small></div>
      <div class="krea-beta-actions"><button id="saveKreaBetaKeyBtn" class="primary" type="button">Lưu key</button><button id="testKreaBetaKeyBtn" class="secondary" type="button">Kiểm tra kết nối</button><button id="clearKreaBetaKeyBtn" class="danger-text" type="button">Xóa key</button></div>
    `;
    advanced.before(card);
  }

  function installProviderOption() {
    const provider = $id('jobProviderSelect');
    if (!provider || provider.querySelector('option[value="krea"]')) return;
    const option = document.createElement('option');
    option.value = 'krea';
    option.textContent = 'Krea AI Beta';
    provider.append(option);

    const settingsProvider = $id('aiProviderSelect');
    if (settingsProvider && !settingsProvider.querySelector('option[value="krea"]')) {
      const settingsOption = option.cloneNode(true);
      settingsProvider.append(settingsOption);
      settingsOption.disabled = true;
      settingsOption.textContent = 'Krea AI Beta · cấu hình riêng bên dưới';
    }
  }

  function ensureProviderNote() {
    if ($id('kreaProviderNote')) return;
    const modelGroup = $id('aiModelSelect')?.closest('.setting-group');
    if (!modelGroup) return;
    const note = document.createElement('div');
    note.id = 'kreaProviderNote';
    note.className = 'krea-provider-note';
    note.hidden = true;
    note.textContent = 'Krea chạy độc lập, không cần Gemini hoặc OpenAI. Topaz Faithful là lựa chọn bảo toàn tốt nhất để test ảnh in ấn.';
    modelGroup.insertAdjacentElement('afterend', note);
  }

  function renderKreaModels() {
    const select = $id('aiModelSelect');
    if (!select) return;
    select.replaceChildren();
    for (const [value, label] of KREA_MODELS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
  }

  function syncProviderUi() {
    const provider = $id('jobProviderSelect')?.value;
    const isKrea = provider === 'krea';
    if (isKrea) renderKreaModels();
    $id('kreaProviderNote') && ($id('kreaProviderNote').hidden = !isKrea);
    const sizeLabel = $id('aiSizeSetting')?.querySelector('label');
    if (sizeLabel) sizeLabel.textContent = isKrea ? 'Tỷ lệ upscale Krea' : 'Độ phân giải AI';
    const sizeSelect = $id('aiImageSize');
    if (sizeSelect && isKrea) {
      sizeSelect.innerHTML = '<option value="2">2× · khuyến nghị test</option><option value="4">4×</option>';
      $id('aiSizeSetting').hidden = false;
    }
    if ($id('runBtn') && typeof state !== 'undefined' && state.tool === 'ai-enhance') {
      $id('runBtn').textContent = isKrea ? 'Tăng cường bằng Krea' : 'Tăng cường bằng AI';
    }
  }

  function renderStatus(status, message = '') {
    const label = $id('kreaBetaKeyStatus');
    if (!label) return;
    label.classList.remove('ok', 'error');
    kreaState.configured = Boolean(status?.configured);
    if (message) label.textContent = message;
    else if (status?.configured) {
      label.textContent = `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}`;
      label.classList.add('ok');
    } else label.textContent = 'Chưa lưu API key';
    $id('testKreaBetaKeyBtn').disabled = !status?.configured;
    $id('clearKreaBetaKeyBtn').disabled = !status?.configured;
  }

  async function loadStatus() {
    try { renderStatus(await window.studio.getKreaBetaStatus()); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  async function saveKey() {
    const input = $id('kreaBetaApiKeyInput');
    const apiKey = input?.value.trim() || '';
    if (!apiKey) { renderStatus(null, 'Hãy nhập Krea API key trước khi lưu.'); $id('kreaBetaKeyStatus')?.classList.add('error'); return; }
    renderStatus(null, 'Đang lưu API key...');
    try { const status = await window.studio.saveKreaBetaKey(apiKey); input.value = ''; renderStatus(status); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  async function testConnection() {
    if ($id('kreaBetaApiKeyInput')?.value.trim()) await saveKey();
    renderStatus(null, 'Đang kiểm tra kết nối Krea...');
    try {
      await window.studio.testKreaBetaConnection();
      const status = await window.studio.getKreaBetaStatus();
      renderStatus(status, `Kết nối Krea thành công · key kết thúc bằng ${status.suffix || '••••'}`);
      $id('kreaBetaKeyStatus')?.classList.add('ok');
    } catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  async function clearKey() {
    if (!window.confirm('Xóa Krea API key đã lưu trên máy này?')) return;
    try { renderStatus(await window.studio.clearKreaBetaKey()); $id('kreaBetaApiKeyInput').value = ''; }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  function creativityFromMode() {
    const mode = document.querySelector('input[name="aiMode"]:checked')?.value || 'safe';
    return mode === 'creative' ? 5 : mode === 'balanced' ? 3 : 1;
  }

  async function runKreaAsProvider(event) {
    if ($id('jobProviderSelect')?.value !== 'krea' || typeof state === 'undefined' || state.tool !== 'ai-enhance') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (kreaState.running || !state.inputPath) return;

    if (!kreaState.configured) {
      await openSettings();
      $id('resultBox').classList.add('error');
      $id('resultBox').textContent = 'Chưa có API key Krea. Nhập key trong Cài đặt → Krea AI Beta.';
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
    $id('progressText').textContent = 'Đang tải ảnh lên Krea...';

    try {
      const result = await window.studio.runKreaBetaEnhance({
        inputPath: state.inputPath,
        outputPath: state.outputPath,
        options: {
          modelId: $id('aiModelSelect').value,
          scale: Number($id('aiImageSize').value) || 2,
          prompt: $id('customPrompt').value,
          creativity: creativityFromMode(),
          texture: creativityFromMode(),
          protectFace: $id('protectFace').checked,
          protectText: $id('protectText').checked,
          protectLogo: $id('protectLogo').checked,
          preserveColor: $id('preserveColor').checked
        }
      });
      $id('progressBar').style.width = '100%';
      $id('progressText').textContent = 'Krea đã hoàn tất.';
      $id('resultBox').classList.remove('error');
      $id('resultBox').textContent = `Đã lưu kết quả ${result.modelLabel || 'Krea'}: ${result.outputPath}`;
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
  ensureProviderNote();

  $id('saveKreaBetaKeyBtn')?.addEventListener('click', saveKey);
  $id('testKreaBetaKeyBtn')?.addEventListener('click', testConnection);
  $id('clearKreaBetaKeyBtn')?.addEventListener('click', clearKey);
  $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  $id('jobProviderSelect')?.addEventListener('change', () => {
    localStorage.setItem(PROVIDER_KEY, $id('jobProviderSelect').value);
    syncProviderUi();
  });
  $id('runBtn')?.addEventListener('click', runKreaAsProvider, true);

  if (typeof window.selectTool === 'function') {
    const originalSelectTool = window.selectTool;
    window.selectTool = function selectToolWithKreaProvider(tool) {
      originalSelectTool(tool);
      if (tool === 'ai-enhance' && localStorage.getItem(PROVIDER_KEY) === 'krea') {
        $id('jobProviderSelect').value = 'krea';
      }
      syncProviderUi();
    };
  }

  window.studio.onKreaBetaProgress?.((progress) => {
    if (!kreaState.running) return;
    if (progress?.message) $id('progressText').textContent = progress.message;
    const percentByStatus = { preparing: 10, uploading: 20, queued: 35, processing: 65, completed: 100 };
    const percent = percentByStatus[progress?.status];
    if (percent) $id('progressBar').style.width = `${percent}%`;
  });

  loadStatus();
  if (localStorage.getItem(PROVIDER_KEY) === 'krea') $id('jobProviderSelect').value = 'krea';
  syncProviderUi();
})();