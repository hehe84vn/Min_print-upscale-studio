(() => {
  const $id = (id) => document.getElementById(id);
  const KREA_MODELS = [
    ['topaz', 'Topaz · Faithful'],
    ['topaz-generative', 'Topaz Generative · Detail'],
    ['topaz-bloom', 'Topaz Bloom · Creative'],
    ['krea-enhance', 'Krea Enhance · Budget Creative']
  ];
  const PROVIDER_KEY = 'aiEnhanceSelectedProvider';
  const kreaState = { configured: false, running: false, metadata: null };

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
      .krea-size-info{margin-top:8px;padding:9px 10px;border:1px solid #3b4658;border-radius:8px;color:#aeb9ca;font-size:10px;line-height:1.5}
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
    option.value = 'krea'; option.textContent = 'Krea AI Beta'; provider.append(option);
    const settingsProvider = $id('aiProviderSelect');
    if (settingsProvider && !settingsProvider.querySelector('option[value="krea"]')) {
      const settingsOption = option.cloneNode(true); settingsProvider.append(settingsOption);
      settingsOption.disabled = true; settingsOption.textContent = 'Krea AI Beta · cấu hình riêng bên dưới';
    }
  }

  function ensureProviderNote() {
    if ($id('kreaProviderNote')) return;
    const modelGroup = $id('aiModelSelect')?.closest('.setting-group');
    if (!modelGroup) return;
    const note = document.createElement('div');
    note.id = 'kreaProviderNote'; note.className = 'krea-provider-note'; note.hidden = true;
    note.textContent = 'Krea chạy độc lập. Topaz Faithful phù hợp nhất khi cần bảo toàn ảnh in ấn. K là số pixel của cạnh dài.';
    modelGroup.insertAdjacentElement('afterend', note);
  }

  function ensureSizingInfo() {
    if ($id('kreaSizingInfo')) return;
    const group = $id('aiSizeSetting');
    if (!group) return;
    const info = document.createElement('div');
    info.id = 'kreaSizingInfo'; info.className = 'krea-size-info'; info.hidden = true;
    group.append(info);
  }

  function renderKreaModels() {
    const select = $id('aiModelSelect'); if (!select) return;
    select.replaceChildren();
    for (const [value, label] of KREA_MODELS) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
  }

  function selectedSizing() {
    const value = $id('aiImageSize')?.value || 'scale:2';
    if (value.startsWith('long:')) return { targetLongEdge: Number(value.slice(5)) };
    return { scale: Number(value.replace('scale:', '')) || 2 };
  }

  async function updateSizingInfo() {
    const info = $id('kreaSizingInfo');
    if (!info || $id('jobProviderSelect')?.value !== 'krea') return;
    info.hidden = false;
    if (typeof state === 'undefined' || !state.inputPath) { info.textContent = 'Chọn ảnh để xem kích thước đầu ra dự kiến.'; return; }
    try {
      kreaState.metadata = await window.studio.inspectImage(state.inputPath);
      const width = Number(kreaState.metadata?.width); const height = Number(kreaState.metadata?.height);
      if (!width || !height) throw new Error('Không đọc được kích thước ảnh.');
      const longEdge = Math.max(width, height); const sizing = selectedSizing();
      const requestedScale = sizing.targetLongEdge ? sizing.targetLongEdge / longEdge : sizing.scale;
      const modelId = $id('aiModelSelect')?.value || 'topaz';
      const maxByModel = modelId === 'topaz' ? 22000 : modelId === 'topaz-generative' ? 16000 : modelId === 'topaz-bloom' ? 10000 : 8000;
      const actualScale = Math.min(Math.max(1, requestedScale), 32, maxByModel / longEdge);
      const outW = Math.round(width * actualScale); const outH = Math.round(height * actualScale);
      const cmW = (outW / 300 * 2.54).toFixed(1); const cmH = (outH / 300 * 2.54).toFixed(1);
      const limited = actualScale + 0.0001 < requestedScale ? ' · đã giới hạn theo model' : '';
      info.textContent = `Nguồn: ${width} × ${height}px · Dự kiến: ${outW} × ${outH}px · ${actualScale.toFixed(2)}×${limited} · In 300 DPI: ${cmW} × ${cmH}cm`;
    } catch (error) { info.textContent = error.message || String(error); }
  }

  function syncProviderUi() {
    const isKrea = $id('jobProviderSelect')?.value === 'krea';
    if (isKrea) renderKreaModels();
    if ($id('kreaProviderNote')) $id('kreaProviderNote').hidden = !isKrea;
    if ($id('kreaSizingInfo')) $id('kreaSizingInfo').hidden = !isKrea;
    const sizeLabel = $id('aiSizeSetting')?.querySelector('label');
    if (sizeLabel) sizeLabel.textContent = isKrea ? 'Kích thước đầu ra Krea' : 'Độ phân giải AI';
    const sizeSelect = $id('aiImageSize');
    if (sizeSelect && isKrea) {
      sizeSelect.innerHTML = [
        ['scale:2', '2× · khuyến nghị test'], ['scale:4', '4×'],
        ['long:4000', '4K · cạnh dài 4.000px'], ['long:8000', '8K · cạnh dài 8.000px'],
        ['long:12000', '12K · cạnh dài 12.000px'], ['long:16000', '16K · cạnh dài 16.000px'],
        ['long:22000', '22K · tối đa Topaz']
      ].map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
      $id('aiSizeSetting').hidden = false;
    }
    if ($id('runBtn') && typeof state !== 'undefined' && state.tool === 'ai-enhance') $id('runBtn').textContent = isKrea ? 'Tăng cường bằng Krea' : 'Tăng cường bằng AI';
    if (isKrea) updateSizingInfo();
  }

  function renderStatus(status, message = '') {
    const label = $id('kreaBetaKeyStatus'); if (!label) return;
    label.classList.remove('ok', 'error'); kreaState.configured = Boolean(status?.configured);
    if (message) label.textContent = message;
    else if (status?.configured) { label.textContent = `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}`; label.classList.add('ok'); }
    else label.textContent = 'Chưa lưu API key';
    $id('testKreaBetaKeyBtn').disabled = !status?.configured; $id('clearKreaBetaKeyBtn').disabled = !status?.configured;
  }

  async function loadStatus() { try { renderStatus(await window.studio.getKreaBetaStatus()); } catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); } }
  async function saveKey() {
    const input = $id('kreaBetaApiKeyInput'); const apiKey = input?.value.trim() || '';
    if (!apiKey) { renderStatus(null, 'Hãy nhập Krea API key trước khi lưu.'); $id('kreaBetaKeyStatus')?.classList.add('error'); return; }
    renderStatus(null, 'Đang lưu API key...');
    try { const status = await window.studio.saveKreaBetaKey(apiKey); input.value = ''; renderStatus(status); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }
  async function testConnection() {
    if ($id('kreaBetaApiKeyInput')?.value.trim()) await saveKey(); renderStatus(null, 'Đang kiểm tra kết nối Krea...');
    try { await window.studio.testKreaBetaConnection(); const status = await window.studio.getKreaBetaStatus(); renderStatus(status, `Kết nối Krea thành công · key kết thúc bằng ${status.suffix || '••••'}`); $id('kreaBetaKeyStatus')?.classList.add('ok'); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }
  async function clearKey() {
    if (!window.confirm('Xóa Krea API key đã lưu trên máy này?')) return;
    try { renderStatus(await window.studio.clearKreaBetaKey()); $id('kreaBetaApiKeyInput').value = ''; }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }
  function creativityFromMode() { const mode = document.querySelector('input[name="aiMode"]:checked')?.value || 'safe'; return mode === 'creative' ? 5 : mode === 'balanced' ? 3 : 1; }

  async function runKreaAsProvider(event) {
    if ($id('jobProviderSelect')?.value !== 'krea' || typeof state === 'undefined' || state.tool !== 'ai-enhance') return;
    event.preventDefault(); event.stopImmediatePropagation(); if (kreaState.running || !state.inputPath) return;
    if (!kreaState.configured) { await openSettings(); $id('resultBox').classList.add('error'); $id('resultBox').textContent = 'Chưa có API key Krea. Nhập key trong Cài đặt → Krea AI Beta.'; $id('resultBox').hidden = false; return; }
    if (!state.outputPath) await chooseOutput(); if (!state.outputPath) return;
    kreaState.running = true; $id('runBtn').disabled = true; $id('progressWrap').hidden = false; $id('resultBox').hidden = true; $id('progressBar').style.width = '5%'; $id('progressText').textContent = 'Đang tải ảnh lên Krea...';
    try {
      const result = await window.studio.runKreaBetaEnhance({
        inputPath: state.inputPath, outputPath: state.outputPath,
        options: { modelId: $id('aiModelSelect').value, ...selectedSizing(), prompt: $id('customPrompt').value, creativity: creativityFromMode(), texture: creativityFromMode(), protectFace: $id('protectFace').checked, protectText: $id('protectText').checked, protectLogo: $id('protectLogo').checked, preserveColor: $id('preserveColor').checked }
      });
      const s = result.sizing; $id('progressBar').style.width = '100%'; $id('progressText').textContent = 'Krea đã hoàn tất.'; $id('resultBox').classList.remove('error');
      $id('resultBox').textContent = `Đã lưu ${result.modelLabel || 'Krea'}${s ? ` · dự kiến ${s.outputWidth} × ${s.outputHeight}px (${s.scale.toFixed(2)}×)` : ''}: ${result.outputPath}`; $id('resultBox').hidden = false; await showComparison(result.outputPath);
    } catch (error) { $id('resultBox').classList.add('error'); $id('resultBox').textContent = error.message || String(error); $id('resultBox').hidden = false; }
    finally { kreaState.running = false; $id('runBtn').disabled = !state.inputPath; }
  }

  installStyles(); installSettingsCard(); installProviderOption(); ensureProviderNote(); ensureSizingInfo();
  $id('saveKreaBetaKeyBtn')?.addEventListener('click', saveKey); $id('testKreaBetaKeyBtn')?.addEventListener('click', testConnection); $id('clearKreaBetaKeyBtn')?.addEventListener('click', clearKey); $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  $id('jobProviderSelect')?.addEventListener('change', () => { localStorage.setItem(PROVIDER_KEY, $id('jobProviderSelect').value); syncProviderUi(); });
  $id('aiImageSize')?.addEventListener('change', updateSizingInfo); $id('aiModelSelect')?.addEventListener('change', updateSizingInfo); $id('runBtn')?.addEventListener('click', runKreaAsProvider, true);
  if (typeof window.selectTool === 'function') { const originalSelectTool = window.selectTool; window.selectTool = function selectToolWithKreaProvider(tool) { originalSelectTool(tool); if (tool === 'ai-enhance' && localStorage.getItem(PROVIDER_KEY) === 'krea') $id('jobProviderSelect').value = 'krea'; syncProviderUi(); }; }
  window.studio.onKreaBetaProgress?.((progress) => { if (!kreaState.running) return; if (progress?.message) $id('progressText').textContent = progress.message; const percentByStatus = { preparing: 10, uploading: 20, queued: 35, processing: 65, completed: 100 }; const percent = percentByStatus[progress?.status]; if (percent) $id('progressBar').style.width = `${percent}%`; });
  loadStatus(); if (localStorage.getItem(PROVIDER_KEY) === 'krea') $id('jobProviderSelect').value = 'krea'; syncProviderUi();
})();