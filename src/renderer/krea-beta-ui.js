(() => {
  const $id = (id) => document.getElementById(id);
  const SUPPORTED_TOOLS = new Set(['ai-enhance', 'restore', 'vector-logo']);
  const kreaState = { configured: false, sourcePath: null, localPath: null, kreaPath: null, running: false };

  function installStyles() {
    if ($id('kreaBetaSettingsStyles')) return;
    const style = document.createElement('style');
    style.id = 'kreaBetaSettingsStyles';
    style.textContent = `
      .krea-beta-settings-card,.krea-beta-job-card{margin:14px 0;padding:14px;border:1px solid #7656a0;border-radius:12px;background:#171225}
      .krea-beta-settings-card h3,.krea-beta-job-card h3{margin:0 0 4px;font-size:14px;color:#dfccff}
      .krea-beta-settings-card p,.krea-beta-job-card p{margin:0 0 12px;color:var(--muted);font-size:10px;line-height:1.45}
      .krea-beta-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}
      .krea-beta-status{display:block;margin-top:7px;font-size:10px;color:#9ba8ba}.krea-beta-status.ok{color:#85d9a0}.krea-beta-status.error{color:#ff9a9a}
      .krea-beta-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.krea-beta-switch input{width:18px;height:18px}
      .krea-beta-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.krea-beta-compare{margin-top:12px;padding-top:12px;border-top:1px solid #3b2d52}.krea-beta-result-note{white-space:pre-line}
      .krea-beta-warning{padding:9px;border-radius:8px;background:#241b12;border:1px solid #6d522b;color:#d8bd87;font-size:10px;line-height:1.45;margin-bottom:10px}
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
      <p>App dùng trực tiếp các endpoint Image Enhance chính thức của Krea. Bạn chỉ cần nhập API key; không cần cấu hình endpoint thủ công.</p>
      <div class="setting-group"><label for="kreaBetaApiKeyInput">Krea API key</label><input id="kreaBetaApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Tự nhập Krea API key tại đây" /><small id="kreaBetaKeyStatus" class="krea-beta-status">Đang kiểm tra...</small></div>
      <div class="krea-beta-actions"><button id="saveKreaBetaKeyBtn" class="primary" type="button">Lưu key</button><button id="testKreaBetaKeyBtn" class="secondary" type="button">Kiểm tra kết nối</button><button id="clearKreaBetaKeyBtn" class="danger-text" type="button">Xóa key</button></div>
    `;
    advanced.before(card);
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
        <div id="kreaBetaModelWarning" class="krea-beta-warning" hidden></div>
        <div class="krea-beta-grid">
          <div class="setting-group"><label for="kreaBetaRunMode">Chế độ chạy</label><select id="kreaBetaRunMode"><option value="krea-only">Chỉ Krea</option><option value="compare" selected>Local + Krea để so sánh</option></select></div>
          <div class="setting-group"><label for="kreaBetaModel">Model Krea</label><select id="kreaBetaModel"><option value="topaz">Topaz · Faithful</option><option value="topaz-generative">Topaz Generative · Detail</option><option value="topaz-bloom">Topaz Bloom · Creative</option><option value="krea-enhance">Krea Enhance · Budget Creative</option></select></div>
          <div class="setting-group"><label for="kreaBetaScale">Tỷ lệ Krea</label><select id="kreaBetaScale"><option value="2">2× · khuyến nghị test</option><option value="4">4×</option></select></div>
          <div class="setting-group"><label for="kreaBetaCreativity">Mức sáng tạo</label><select id="kreaBetaCreativity"><option value="1">1 · rất thấp</option><option value="2" selected>2 · bảo toàn</option><option value="3">3 · cân bằng</option><option value="5">5 · mạnh</option></select></div>
        </div>
        <div class="protection-grid"><label class="check-row"><input id="kreaBetaProtectFace" type="checkbox" checked /><span>Giữ khuôn mặt</span></label><label class="check-row"><input id="kreaBetaProtectText" type="checkbox" checked /><span>Ưu tiên chữ</span></label><label class="check-row"><input id="kreaBetaPreserveColor" type="checkbox" checked /><span>Giữ màu gốc</span></label></div>
        <div class="setting-group"><label for="kreaBetaPrompt">Yêu cầu bổ sung</label><input id="kreaBetaPrompt" class="text-input" maxlength="2000" placeholder="Mô tả ngắn nội dung cần giữ nguyên" /></div>
        <button id="runKreaBetaBtn" class="secondary wide" type="button">Chạy Krea Beta</button>
        <small id="kreaBetaRunStatus" class="krea-beta-status krea-beta-result-note">Chưa chạy.</small>
        <div id="kreaBetaCompareControls" class="krea-beta-compare" hidden><div class="krea-beta-grid"><div class="setting-group"><label for="kreaBetaBeforeSelect">Ảnh A</label><select id="kreaBetaBeforeSelect"><option value="source">Ảnh gốc</option><option value="local">Local</option><option value="krea">Krea</option></select></div><div class="setting-group"><label for="kreaBetaAfterSelect">Ảnh B</label><select id="kreaBetaAfterSelect"><option value="source">Ảnh gốc</option><option value="local">Local</option><option value="krea" selected>Krea</option></select></div></div></div>
      </div>
    `;
    aiCard.append(card);
  }

  function renderStatus(status, message = '') {
    const label = $id('kreaBetaKeyStatus'); if (!label) return;
    label.classList.remove('ok', 'error'); kreaState.configured = Boolean(status?.configured);
    if (message) label.textContent = message;
    else if (status?.configured) { label.textContent = `Đã lưu an toàn · kết thúc bằng ${status.suffix || '••••'}`; label.classList.add('ok'); }
    else label.textContent = 'Chưa lưu API key';
    $id('testKreaBetaKeyBtn').disabled = !status?.configured; $id('clearKreaBetaKeyBtn').disabled = !status?.configured; syncRunAvailability();
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
    if ($id('kreaBetaApiKeyInput')?.value.trim()) await saveKey();
    renderStatus(null, 'Đang kiểm tra kết nối Krea...');
    try { await window.studio.testKreaBetaConnection(); const status = await window.studio.getKreaBetaStatus(); renderStatus(status, `Kết nối Krea thành công · key kết thúc bằng ${status.suffix || '••••'}`); $id('kreaBetaKeyStatus')?.classList.add('ok'); }
    catch (error) { renderStatus(null, error.message || String(error)); $id('kreaBetaKeyStatus')?.classList.add('error'); }
  }
  async function clearKey() { if (!window.confirm('Xóa Krea API key đã lưu trên máy này?')) return; try { renderStatus(await window.studio.clearKreaBetaKey()); $id('kreaBetaApiKeyInput').value = ''; } catch (error) { renderStatus(null, error.message || String(error)); } }

  function currentToolSupported() { return typeof state !== 'undefined' && SUPPORTED_TOOLS.has(state.tool); }
  function updateModelWarning() {
    const id = $id('kreaBetaModel')?.value; const warning = $id('kreaBetaModelWarning'); if (!warning) return;
    const messages = {
      topaz: 'Topaz Faithful phù hợp ảnh chụp, restore nhẹ, packaging và tiền xử lý vector. Đây là lựa chọn mặc định an toàn hơn.',
      'topaz-generative': 'Topaz Generative có thể tạo thêm chi tiết. Luôn so sánh A/B trước khi dùng cho in ấn.',
      'topaz-bloom': 'Topaz Bloom thay đổi hình mạnh nhất. Không nên dùng cho chữ, logo hoặc artwork cần fidelity.',
      'krea-enhance': 'Krea Enhance là enhancer sáng tạo chi phí thấp. Chỉ nên dùng cho ảnh chụp hoặc thử nghiệm.'
    };
    warning.textContent = messages[id] || ''; warning.hidden = id === 'topaz';
  }
  function syncRunAvailability() {
    const enabled = Boolean($id('kreaBetaEnabled')?.checked);
    if ($id('kreaBetaJobControls')) $id('kreaBetaJobControls').hidden = !enabled;
    if ($id('runKreaBetaBtn')) $id('runKreaBetaBtn').disabled = kreaState.running || !enabled || !kreaState.configured || !state?.inputPath || !currentToolSupported();
    if ($id('kreaBetaModuleHint')) $id('kreaBetaModuleHint').textContent = state?.tool === 'restore' ? 'Krea hỗ trợ phục hồi ảnh chụp; Topaz Faithful là mặc định.' : state?.tool === 'vector-logo' ? 'Krea chỉ làm sạch raster trước khi vector hóa; không thay thế SVG engine.' : 'So sánh Krea với pipeline local trên cùng ảnh nguồn.';
    updateModelWarning();
  }
  function derivedLocalPath(kreaPath) { return kreaPath.replace(/(\.[^.]+)$/i, '-local$1'); }
  async function urlFor(pathValue) { return pathValue ? `${await window.studio.fileUrl(pathValue)}?t=${Date.now()}` : null; }
  async function updateComparison() {
    const map = { source: kreaState.sourcePath, local: kreaState.localPath, krea: kreaState.kreaPath };
    const beforePath = map[$id('kreaBetaBeforeSelect').value]; const afterPath = map[$id('kreaBetaAfterSelect').value];
    if (beforePath && afterPath) showComparisonUrls(await urlFor(beforePath), await urlFor(afterPath));
  }
  async function runKrea() {
    if (kreaState.running || !state?.inputPath) return;
    const kreaOutput = await window.studio.selectKreaBetaOutput({ inputPath: state.inputPath }); if (!kreaOutput) return;
    kreaState.running = true; kreaState.sourcePath = state.inputPath; kreaState.kreaPath = null; kreaState.localPath = null; syncRunAvailability();
    const status = $id('kreaBetaRunStatus'); status.classList.remove('error', 'ok'); status.textContent = 'Đang chuẩn bị...';
    try {
      if ($id('kreaBetaRunMode').value === 'compare') {
        const localOutput = derivedLocalPath(kreaOutput); status.textContent = 'Đang chạy pipeline local...';
        const local = await window.studio.process({ operation: 'upscale', inputPath: state.inputPath, outputPath: localOutput, options: { scale: Number($id('kreaBetaScale').value), model: $id('modelSelect')?.value || 'high-fidelity-4x', dpi: Number($id('dpiSelect')?.value) || 300, quality: 95, useNcnn: true, allowFallback: true, sharpen: true } });
        kreaState.localPath = local.outputPath;
      }
      status.textContent = 'Đang tải ảnh lên và chờ Krea xử lý...';
      const result = await window.studio.runKreaBetaEnhance({ inputPath: state.inputPath, outputPath: kreaOutput, options: { modelId: $id('kreaBetaModel').value, scale: Number($id('kreaBetaScale').value), prompt: $id('kreaBetaPrompt').value, creativity: Number($id('kreaBetaCreativity').value), texture: Number($id('kreaBetaCreativity').value), protectFace: $id('kreaBetaProtectFace').checked, protectText: $id('kreaBetaProtectText').checked, preserveColor: $id('kreaBetaPreserveColor').checked } });
      kreaState.kreaPath = result.outputPath; status.textContent = `Krea hoàn tất bằng ${result.modelLabel}.\nKrea: ${result.outputPath}${kreaState.localPath ? `\nLocal: ${kreaState.localPath}` : ''}`; status.classList.add('ok');
      $id('kreaBetaCompareControls').hidden = false; $id('kreaBetaBeforeSelect').value = kreaState.localPath ? 'local' : 'source'; $id('kreaBetaAfterSelect').value = 'krea';
      [...$id('kreaBetaBeforeSelect').options, ...$id('kreaBetaAfterSelect').options].forEach((option) => { if (option.value === 'local') option.disabled = !kreaState.localPath; });
      await updateComparison();
    } catch (error) { status.textContent = error.message || String(error); status.classList.add('error'); }
    finally { kreaState.running = false; syncRunAvailability(); }
  }

  installStyles(); installSettingsCard(); installJobCard();
  $id('saveKreaBetaKeyBtn')?.addEventListener('click', saveKey); $id('testKreaBetaKeyBtn')?.addEventListener('click', testConnection); $id('clearKreaBetaKeyBtn')?.addEventListener('click', clearKey);
  $id('kreaBetaEnabled')?.addEventListener('change', syncRunAvailability); $id('kreaBetaModel')?.addEventListener('change', updateModelWarning); $id('runKreaBetaBtn')?.addEventListener('click', runKrea);
  $id('kreaBetaBeforeSelect')?.addEventListener('change', updateComparison); $id('kreaBetaAfterSelect')?.addEventListener('change', updateComparison); $id('appSettingsBtn')?.addEventListener('click', loadStatus);
  if (typeof window.selectTool === 'function') { const original = window.selectTool; window.selectTool = function selectToolWithKrea(tool) { original(tool); syncRunAvailability(); }; }
  window.studio.onKreaBetaProgress?.((progress) => { if (kreaState.running && progress?.message) $id('kreaBetaRunStatus').textContent = progress.message; });
  loadStatus(); syncRunAvailability();
})();
