(() => {
  const $id = (id) => document.getElementById(id);
  const ENDPOINT_KEY = 'kreaBetaEnhancerEndpoint';
  const SUPPORTED_TOOLS = new Set(['ai-enhance', 'restore', 'vector-logo']);
  const kreaState = {
    configured: false,
    localPath: null,
    kreaPath: null,
    sourcePath: null,
    running: false
  };

  function installStyles() {
    if ($id('kreaBetaSettingsStyles')) return;
    const style = document.createElement('style');
    style.id = 'kreaBetaSettingsStyles';
    style.textContent = `
      .krea-beta-settings-card,.krea-beta-job-card { margin:14px 0;padding:14px;border:1px solid #7656a0;border-radius:12px;background:#171225; }
      .krea-beta-settings-card h3,.krea-beta-job-card h3 { margin:0 0 4px;font-size:14px;color:#dfccff; }
      .krea-beta-settings-card p,.krea-beta-job-card p { margin:0 0 12px;color:var(--muted);font-size:10px;line-height:1.45; }
      .krea-beta-actions { display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px; }
      .krea-beta-status { display:block;margin-top:7px;font-size:10px;color:#9ba8ba; }
      .krea-beta-status.ok { color:#85d9a0; }.krea-beta-status.error { color:#ff9a9a; }
      .krea-beta-switch { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px; }
      .krea-beta-switch input { width:18px;height:18px; }
      .krea-beta-grid { display:grid;grid-template-columns:1fr 1fr;gap:9px; }
      .krea-beta-compare { margin-top:12px;padding-top:12px;border-top:1px solid #3b2d52; }
      .krea-beta-result-note { white-space:pre-line; }
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
      <p>API key được lưu bằng bộ lưu trữ bảo mật của macOS hoặc Windows. Endpoint không chứa bí mật và chỉ dùng cho beta.</p>
      <div class="setting-group"><label for="kreaBetaApiKeyInput">Krea API key</label><input id="kreaBetaApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Tự nhập Krea API key tại đây" /><small id="kreaBetaKeyStatus" class="krea-beta-status">Đang kiểm tra...</small></div>
      <div class="setting-group"><label for="kreaBetaEndpointInput">Enhancer endpoint</label><input id="kreaBetaEndpointInput" class="text-input" type="text" spellcheck="false" placeholder="Ví dụ endpoint được cung cấp trong Krea API dashboard" /><small class="krea-beta-status">Phải bắt đầu bằng /. Không nhập API key vào ô này.</small></div>
      <div class="krea-beta-actions"><button id="saveKreaBetaKeyBtn" class="primary" type="button">Lưu key & endpoint</button><button id="testKreaBetaKeyBtn" class="secondary" type="button">Kiểm tra kết nối</button><button id="clearKreaBetaKeyBtn" class="danger-text" type="button">Xóa key</button></div>
    `;
    advanced.before(card);
    $id('kreaBetaEndpointInput').value = localStorage.getItem(ENDPOINT_KEY) || '';
  }

  function installJobCard() {
    if ($id('kreaBetaJobCard')) return;
    const aiCard = $id('aiEnhanceSettings');
    if (!aiCard) return;
    const card = document.createElement('section');
    card.id = 'kreaBetaJobCard';
    card.className = 'krea-beta-job-card';
    card.innerHTML = `
      <div class="krea-beta-switch"><div><h3>Krea AI Beta</h3><p id="kreaBetaModuleHint">Dùng Krea như engine cloud tùy chọn.</p></div><input id="kreaBetaEnabled" type="checkbox" /></div>
      <div id="kreaBetaJobControls" hidden>
        <div class="krea-beta-grid">
          <div class="setting-group"><label for="kreaBetaRunMode">Chế độ chạy</label><select id="kreaBetaRunMode"><option value="krea-only">Chỉ Krea</option><option value="compare" selected>Local + Krea để so sánh</option></select></div>
          <div class="setting-group"><label for="kreaBetaEnhanceMode">Krea model mode</label><select id="kreaBetaEnhanceMode"><option value="standard">Standard · an toàn hơn</option><option value="generative">Generative · thêm chi tiết</option><option value="bloom">Bloom · sáng tạo mạnh</option></select></div>
          <div class="setting-group"><label for="kreaBetaScale">Tỷ lệ Krea</label><select id="kreaBetaScale"><option value="2">2×</option><option value="4">4×</option></select></div>
          <div class="setting-group"><label for="kreaBetaPrompt">Yêu cầu bổ sung</label><input id="kreaBetaPrompt" class="text-input" maxlength="2000" placeholder="Giữ khuôn mặt, màu và bố cục gốc" /></div>
        </div>
        <button id="runKreaBetaBtn" class="secondary wide" type="button">Chạy Krea Beta</button>
        <small id="kreaBetaRunStatus" class="krea-beta-status krea-beta-result-note">Chưa chạy.</small>
        <div id="kreaBetaCompareControls" class="krea-beta-compare" hidden>
          <div class="krea-beta-grid"><div class="setting-group"><label for="kreaBetaBeforeSelect">Ảnh A</label><select id="kreaBetaBeforeSelect"><option value="source">Ảnh gốc</option><option value="local">Local</option><option value="krea">Krea</option></select></div><div class="setting-group"><label for="kreaBetaAfterSelect">Ảnh B</label><select id="kreaBetaAfterSelect"><option value="source">Ảnh gốc</option><option value="local">Local</option><option value="krea" selected>Krea</option></select></div></div>
        </div>
      </div>
    `;
    aiCard.append(card);
  }

  function renderStatus(status, message = '') {
    const label = $id('kreaBetaKeyStatus');
    if (!label) return;
    label.classList.remove('ok', 'error');
    kreaState.configured = Boolean(status?.configured);
    if (message) label.textContent = message;
    else if (status?.configured) { label.textContent = `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}`; label.classList.add('ok'); }
    else label.textContent = 'Chưa lưu API key';
    $id('testKreaBetaKeyBtn').disabled = !status?.configured;
    $id('clearKreaBetaKeyBtn').disabled = !status?.configured;
    syncRunAvailability();
  }

  async function loadStatus() {
    try { renderStatus(await window.studio.getKreaBetaStatus()); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  async function saveKey() {
    const input = $id('kreaBetaApiKeyInput');
    const apiKey = input?.value.trim() || '';
    const endpoint = $id('kreaBetaEndpointInput')?.value.trim() || '';
    if (endpoint && !endpoint.startsWith('/')) { renderStatus(null, 'Endpoint phải bắt đầu bằng /.'); $id('kreaBetaKeyStatus')?.classList.add('error'); return; }
    localStorage.setItem(ENDPOINT_KEY, endpoint);
    if (!apiKey) { await loadStatus(); renderStatus({ configured: kreaState.configured }, kreaState.configured ? 'Đã lưu endpoint. API key hiện tại được giữ nguyên.' : 'Đã lưu endpoint. Chưa có API key.'); return; }
    renderStatus(null, 'Đang lưu API key...');
    try { const status = await window.studio.saveKreaBetaKey(apiKey); input.value = ''; renderStatus(status); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  async function testConnection() {
    const pending = $id('kreaBetaApiKeyInput')?.value.trim();
    if (pending) await saveKey();
    renderStatus(null, 'Đang kiểm tra kết nối Krea...');
    try { await window.studio.testKreaBetaConnection(); const status = await window.studio.getKreaBetaStatus(); renderStatus(status, `Kết nối Krea thành công · key kết thúc bằng ${status.suffix || '••••'}`); $id('kreaBetaKeyStatus')?.classList.add('ok'); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  async function clearKey() {
    if (!window.confirm('Xóa Krea API key đã lưu trên máy này?')) return;
    try { renderStatus(await window.studio.clearKreaBetaKey()); $id('kreaBetaApiKeyInput').value = ''; }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }

  function currentToolSupported() { return typeof state !== 'undefined' && SUPPORTED_TOOLS.has(state.tool); }
  function syncRunAvailability() {
    const enabled = Boolean($id('kreaBetaEnabled')?.checked);
    const endpoint = localStorage.getItem(ENDPOINT_KEY) || '';
    if ($id('kreaBetaJobControls')) $id('kreaBetaJobControls').hidden = !enabled;
    if ($id('runKreaBetaBtn')) $id('runKreaBetaBtn').disabled = kreaState.running || !enabled || !kreaState.configured || !endpoint || !state?.inputPath || !currentToolSupported();
    if ($id('kreaBetaModuleHint')) $id('kreaBetaModuleHint').textContent = state?.tool === 'restore' ? 'Krea hỗ trợ phục hồi ảnh chụp; tránh dùng cho chữ và artwork.' : state?.tool === 'vector-logo' ? 'Krea chỉ làm sạch raster trước khi vector hóa, không thay thế engine SVG.' : 'So sánh Krea với pipeline local trên cùng ảnh nguồn.';
  }

  function derivedLocalPath(kreaPath) { return kreaPath.replace(/(\.[^.]+)$/i, '-local$1'); }
  async function urlFor(pathValue) { return pathValue ? `${await window.studio.fileUrl(pathValue)}?t=${Date.now()}` : null; }

  async function updateComparison() {
    const map = { source: kreaState.sourcePath, local: kreaState.localPath, krea: kreaState.kreaPath };
    const beforePath = map[$id('kreaBetaBeforeSelect').value];
    const afterPath = map[$id('kreaBetaAfterSelect').value];
    if (!beforePath || !afterPath) return;
    showComparisonUrls(await urlFor(beforePath), await urlFor(afterPath));
  }

  async function runKrea() {
    if (kreaState.running || !state?.inputPath) return;
    const endpoint = localStorage.getItem(ENDPOINT_KEY) || '';
    if (!endpoint) { $id('kreaBetaRunStatus').textContent = 'Chưa cấu hình enhancer endpoint trong Cài đặt.'; return; }
    const kreaOutput = await window.studio.selectKreaBetaOutput({ inputPath: state.inputPath });
    if (!kreaOutput) return;
    kreaState.running = true; kreaState.sourcePath = state.inputPath; kreaState.kreaPath = null; kreaState.localPath = null;
    syncRunAvailability();
    $id('kreaBetaRunStatus').classList.remove('error', 'ok');
    $id('kreaBetaRunStatus').textContent = 'Đang chuẩn bị...';
    try {
      if ($id('kreaBetaRunMode').value === 'compare') {
        const localOutput = derivedLocalPath(kreaOutput);
        $id('kreaBetaRunStatus').textContent = 'Đang chạy pipeline local...';
        const local = await window.studio.process({ operation: 'upscale', inputPath: state.inputPath, outputPath: localOutput, options: { scale: Number($id('kreaBetaScale').value), model: $id('modelSelect')?.value || 'high-fidelity-4x', dpi: Number($id('dpiSelect')?.value) || 300, quality: 95, useNcnn: true, allowFallback: true, sharpen: true } });
        kreaState.localPath = local.outputPath;
      }
      $id('kreaBetaRunStatus').textContent = 'Đang gửi ảnh và chờ Krea xử lý...';
      const result = await window.studio.runKreaBetaEnhance({ inputPath: state.inputPath, outputPath: kreaOutput, options: { endpoint, mode: $id('kreaBetaEnhanceMode').value, scale: Number($id('kreaBetaScale').value), prompt: $id('kreaBetaPrompt').value } });
      kreaState.kreaPath = result.outputPath;
      $id('kreaBetaRunStatus').textContent = `Đã hoàn tất.\nKrea: ${result.outputPath}${kreaState.localPath ? `\nLocal: ${kreaState.localPath}` : ''}`;
      $id('kreaBetaRunStatus').classList.add('ok');
      $id('kreaBetaCompareControls').hidden = false;
      $id('kreaBetaBeforeSelect').value = kreaState.localPath ? 'local' : 'source';
      $id('kreaBetaAfterSelect').value = 'krea';
      [...$id('kreaBetaBeforeSelect').options, ...$id('kreaBetaAfterSelect').options].forEach((option) => { if (option.value === 'local') option.disabled = !kreaState.localPath; });
      await updateComparison();
    } catch (error) {
      $id('kreaBetaRunStatus').textContent = error.message || String(error);
      $id('kreaBetaRunStatus').classList.add('error');
    } finally { kreaState.running = false; syncRunAvailability(); }
  }

  installStyles(); installSettingsCard(); installJobCard();
  $id('saveKreaBetaKeyBtn')?.addEventListener('click', saveKey);
  $id('testKreaBetaKeyBtn')?.addEventListener('click', testConnection);
  $id('clearKreaBetaKeyBtn')?.addEventListener('click', clearKey);
  $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  $id('kreaBetaEnabled')?.addEventListener('change', syncRunAvailability);
  $id('runKreaBetaBtn')?.addEventListener('click', runKrea);
  $id('kreaBetaBeforeSelect')?.addEventListener('change', updateComparison);
  $id('kreaBetaAfterSelect')?.addEventListener('change', updateComparison);
  $id('chooseInputBtn')?.addEventListener('click', () => setTimeout(syncRunAvailability, 200));
  $id('changeInputBtn')?.addEventListener('click', () => setTimeout(syncRunAvailability, 200));
  $id('toolNav')?.addEventListener('click', () => setTimeout(syncRunAvailability, 0));
  window.studio.onKreaBetaProgress?.((progress) => { if (kreaState.running && $id('kreaBetaRunStatus')) $id('kreaBetaRunStatus').textContent = progress.message || `Krea: ${progress.status || 'processing'}`; });
  loadStatus(); syncRunAvailability();
})();