(() => {
  const $id = (id) => document.getElementById(id);
  const MODELS = [['kira-3.0-image', 'Kira 3.0 Image'], ['kira-2.0-image', 'Kira 2.0 Image']];
  const providerState = { configured: false, running: false };

  function installSettings() {
    if ($id('kiraAiSettingsCard')) return;
    const anchor = document.querySelector('.advanced-details');
    if (!anchor) return;
    const card = document.createElement('section');
    card.id = 'kiraAiSettingsCard';
    card.className = 'krea-beta-settings-card';
    card.innerHTML = `
      <h3>KiraAI.vn Beta</h3>
      <p>Nhà cung cấp AI hình ảnh độc lập qua API tương thích OpenAI. Luồng hiện tại dùng endpoint /api/v1/chat/completions và ảnh tham chiếu.</p>
      <div class="setting-group"><label for="kiraAiApiKeyInput">KiraAI API key</label><input id="kiraAiApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Nhập API key KiraAI.vn" /><small id="kiraAiKeyStatus" class="krea-beta-status">Đang kiểm tra...</small></div>
      <div class="krea-beta-actions"><button id="saveKiraAiKeyBtn" class="primary" type="button">Lưu key</button><button id="testKiraAiKeyBtn" class="secondary" type="button">Kiểm tra kết nối</button><button id="clearKiraAiKeyBtn" class="danger-text" type="button">Xóa key</button></div>`;
    anchor.before(card);
  }

  function installProvider() {
    const select = $id('jobProviderSelect');
    if (!select || select.querySelector('option[value="kiraai"]')) return;
    const option = document.createElement('option');
    option.value = 'kiraai';
    option.textContent = 'KiraAI.vn Beta';
    select.append(option);
  }

  function renderModels() {
    const select = $id('aiModelSelect');
    if (!select) return;
    select.replaceChildren();
    for (const [value, label] of MODELS) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
  }

  function syncUi() {
    const active = $id('jobProviderSelect')?.value === 'kiraai';
    if (!active) return;
    renderModels();
    const label = $id('aiSizeSetting')?.querySelector('label');
    if (label) label.textContent = 'Mức tăng kích thước yêu cầu';
    const size = $id('aiImageSize');
    if (size) { size.innerHTML = '<option value="2">2× · test an toàn</option><option value="4">4× · yêu cầu cao</option>'; $id('aiSizeSetting').hidden = false; }
    if ($id('runBtn') && typeof state !== 'undefined' && state.tool === 'ai-enhance') $id('runBtn').textContent = 'Tăng cường bằng KiraAI';
  }

  function showStatus(status, message, error = false) {
    const el = $id('kiraAiKeyStatus'); if (!el) return;
    el.classList.toggle('error', error); el.classList.toggle('ok', !error && Boolean(status?.configured));
    providerState.configured = Boolean(status?.configured);
    el.textContent = message || (status?.configured ? `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}` : 'Chưa lưu API key');
    $id('testKiraAiKeyBtn').disabled = !status?.configured;
    $id('clearKiraAiKeyBtn').disabled = !status?.configured;
  }

  async function loadStatus() { try { showStatus(await window.studio.getKiraAiBetaStatus()); } catch (error) { showStatus(null, error.message || String(error), true); } }
  async function saveKey() {
    const input = $id('kiraAiApiKeyInput'); const key = input?.value.trim() || '';
    if (!key) return showStatus(null, 'Hãy nhập API key trước khi lưu.', true);
    try { const status = await window.studio.saveKiraAiBetaKey(key); input.value = ''; showStatus(status); }
    catch (error) { showStatus(null, error.message || String(error), true); }
  }
  async function testKey() {
    if ($id('kiraAiApiKeyInput')?.value.trim()) await saveKey();
    try { await window.studio.testKiraAiBetaConnection(); const status = await window.studio.getKiraAiBetaStatus(); showStatus(status, 'Kết nối KiraAI API thành công.'); }
    catch (error) { showStatus(null, error.message || String(error), true); }
  }
  async function clearKey() {
    if (!window.confirm('Xóa API key KiraAI.vn đã lưu trên máy này?')) return;
    try { showStatus(await window.studio.clearKiraAiBetaKey()); } catch (error) { showStatus(null, error.message || String(error), true); }
  }

  async function run(event) {
    if ($id('jobProviderSelect')?.value !== 'kiraai' || typeof state === 'undefined' || state.tool !== 'ai-enhance') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (providerState.running || !state.inputPath) return;
    if (!providerState.configured) {
      await openSettings();
      $id('resultBox').classList.add('error'); $id('resultBox').textContent = 'Chưa có API key KiraAI.vn. Nhập key trong Cài đặt.'; $id('resultBox').hidden = false; return;
    }
    if (!state.outputPath) {
      state.outputPath = await window.studio.selectKiraAiBetaOutput({ inputPath: state.inputPath });
      if ($id('outputPath')) $id('outputPath').textContent = state.outputPath || 'Chưa chọn';
    }
    if (!state.outputPath) return;
    providerState.running = true; $id('runBtn').disabled = true; $id('progressWrap').hidden = false; $id('progressBar').style.width = '10%'; $id('progressText').textContent = 'Đang gửi ảnh tới KiraAI.vn...';
    try {
      const result = await window.studio.runKiraAiBetaEnhance({ inputPath: state.inputPath, outputPath: state.outputPath, options: { modelId: $id('aiModelSelect').value, scale: Number($id('aiImageSize').value) || 2, prompt: $id('customPrompt').value } });
      $id('progressBar').style.width = '100%'; $id('progressText').textContent = 'KiraAI.vn đã hoàn tất.';
      $id('resultBox').classList.remove('error'); $id('resultBox').textContent = `Đã lưu kết quả ${result.modelLabel}: ${result.outputPath}`; $id('resultBox').hidden = false;
      await showComparison(result.outputPath);
    } catch (error) {
      $id('resultBox').classList.add('error'); $id('resultBox').textContent = error.message || String(error); $id('resultBox').hidden = false;
    } finally { providerState.running = false; $id('runBtn').disabled = !state.inputPath; }
  }

  installSettings(); installProvider();
  $id('saveKiraAiKeyBtn')?.addEventListener('click', saveKey);
  $id('testKiraAiKeyBtn')?.addEventListener('click', testKey);
  $id('clearKiraAiKeyBtn')?.addEventListener('click', clearKey);
  $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  $id('jobProviderSelect')?.addEventListener('change', syncUi);
  $id('runBtn')?.addEventListener('click', run, true);
  window.studio.onKiraAiBetaProgress?.((progress) => {
    if (!providerState.running) return;
    if (progress?.message) $id('progressText').textContent = progress.message;
    const values = { preparing: 10, uploading: 30, processing: 70, completed: 100 }; if (values[progress?.status]) $id('progressBar').style.width = `${values[progress.status]}%`;
  });
  loadStatus(); syncUi();
})();