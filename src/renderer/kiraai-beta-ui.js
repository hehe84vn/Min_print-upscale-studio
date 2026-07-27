(() => {
  const $id = (id) => document.getElementById(id);
  const FALLBACK_MODELS = [['kira-3.0-image', 'Kira 3.0 Image'], ['kira-2.0-image', 'Kira 2.0 Image']];
  const providerState = { configured: false, running: false, models: [], directorAvailable: false };

  function installSettings() {
    if ($id('kiraAiSettingsCard')) return;
    const anchor = document.querySelector('.advanced-details'); if (!anchor) return;
    const card = document.createElement('section'); card.id = 'kiraAiSettingsCard'; card.className = 'krea-beta-settings-card';
    card.innerHTML = `<h3>KiraAI.vn Beta</h3><p>GPT-5.4 đóng vai trò AI Director: phân tích ảnh nguồn, quyết định pipeline, tạo prompt tái dựng; model ảnh Kira/Nano Banana chỉ thực hiện bước sinh ảnh.</p><div class="setting-group"><label for="kiraAiApiKeyInput">KiraAI API key</label><input id="kiraAiApiKeyInput" class="text-input" type="password" autocomplete="off" spellcheck="false" placeholder="Nhập API key KiraAI.vn" /><small id="kiraAiKeyStatus" class="krea-beta-status">Đang kiểm tra...</small></div><div class="krea-beta-actions"><button id="saveKiraAiKeyBtn" class="primary" type="button">Lưu key</button><button id="testKiraAiKeyBtn" class="secondary" type="button">Kiểm tra GPT-5.4 + model ảnh</button><button id="clearKiraAiKeyBtn" class="danger-text" type="button">Xóa key</button></div>`;
    anchor.before(card);
  }

  function installProvider() {
    const select = $id('jobProviderSelect'); if (!select || select.querySelector('option[value="kiraai"]')) return;
    const option = document.createElement('option'); option.value = 'kiraai'; option.textContent = 'KiraAI.vn Beta · GPT-5.4 Director'; select.append(option);
  }

  function renderModels() {
    const select = $id('aiModelSelect'); if (!select) return;
    const current = select.value; select.replaceChildren();
    const models = providerState.models.length ? providerState.models.map((item) => [item.id, item.label || item.name || item.id]) : FALLBACK_MODELS;
    for (const [value, label] of models) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function ensureNotice() {
    if ($id('kiraAiGenerationNotice')) return;
    const modelGroup = $id('aiModelSelect')?.closest('.setting-group'); if (!modelGroup) return;
    const notice = document.createElement('div'); notice.id = 'kiraAiGenerationNotice'; notice.className = 'krea-provider-note'; notice.hidden = true;
    notice.innerHTML = `<strong>GPT-5.4 AI Director</strong><br>Ảnh nguồn được phân tích để chọn pipeline và tạo prompt. Với poster, bao bì, logo hoặc ảnh nhiều chữ, GPT-5.4 có thể chặn tái dựng toàn khung vì nguy cơ đổi bố cục, chữ và logo.<label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px"><input id="forceKiraCreativeRebuild" type="checkbox"><span>Ép chạy Creative Rebuild để thử nghiệm, chấp nhận ảnh có thể khác bản gốc.</span></label>`;
    modelGroup.insertAdjacentElement('afterend', notice);
  }

  function syncUi() {
    const active = $id('jobProviderSelect')?.value === 'kiraai';
    if ($id('kiraAiGenerationNotice')) $id('kiraAiGenerationNotice').hidden = !active;
    if (!active) return;
    renderModels();
    const sizeSetting = $id('aiSizeSetting'); if (sizeSetting) sizeSetting.hidden = true;
    if ($id('runBtn') && typeof state !== 'undefined' && state.tool === 'ai-enhance') $id('runBtn').textContent = 'Phân tích và tái dựng';
  }

  function showStatus(status, message, error = false) {
    const el = $id('kiraAiKeyStatus'); if (!el) return;
    el.classList.toggle('error', error); el.classList.toggle('ok', !error && Boolean(status?.configured));
    providerState.configured = Boolean(status?.configured); providerState.models = Array.isArray(status?.models) ? status.models : providerState.models; providerState.directorAvailable = Boolean(status?.directorAvailable);
    el.textContent = message || (status?.configured ? `Đã lưu · GPT-5.4 ${providerState.directorAvailable ? 'sẵn sàng' : 'chưa xác nhận'} · ${providerState.models.length} model ảnh` : 'Chưa lưu API key');
    $id('testKiraAiKeyBtn').disabled = !status?.configured; $id('clearKiraAiKeyBtn').disabled = !status?.configured;
    if ($id('jobProviderSelect')?.value === 'kiraai') renderModels();
  }

  async function loadStatus() { try { showStatus(await window.studio.getKiraAiBetaStatus()); } catch (error) { showStatus(null, error.message || String(error), true); } }
  async function saveKey() { const input = $id('kiraAiApiKeyInput'); const key = input?.value.trim() || ''; if (!key) return showStatus(null, 'Hãy nhập API key trước khi lưu.', true); try { const status = await window.studio.saveKiraAiBetaKey(key); input.value = ''; showStatus(status); } catch (error) { showStatus(null, error.message || String(error), true); } }
  async function testKey() { if ($id('kiraAiApiKeyInput')?.value.trim()) await saveKey(); try { const result = await window.studio.testKiraAiBetaConnection(); const status = await window.studio.getKiraAiBetaStatus(); showStatus(status, `Kết nối thành công · AI Director ${result.director?.label || 'GPT-5.4'} · ${result.models?.length || 0} model ảnh.`); } catch (error) { showStatus(null, error.message || String(error), true); } }
  async function clearKey() { if (!window.confirm('Xóa API key KiraAI.vn đã lưu trên máy này?')) return; try { showStatus(await window.studio.clearKiraAiBetaKey()); } catch (error) { showStatus(null, error.message || String(error), true); } }
  function inputDimensions() { const image = $id('beforeImage') || $id('previewImage') || document.querySelector('img[data-role="input-preview"]'); return { width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 }; }
  function rebuildMode() { return document.querySelector('input[name="aiMode"]:checked')?.value || 'safe'; }

  async function run(event) {
    if ($id('jobProviderSelect')?.value !== 'kiraai' || typeof state === 'undefined' || state.tool !== 'ai-enhance') return;
    event.preventDefault(); event.stopImmediatePropagation(); if (providerState.running || !state.inputPath) return;
    if (!providerState.configured) { await openSettings(); $id('resultBox').classList.add('error'); $id('resultBox').textContent = 'Chưa có API key KiraAI.vn. Nhập key trong Cài đặt.'; $id('resultBox').hidden = false; return; }
    if (!state.outputPath) { state.outputPath = await window.studio.selectKiraAiBetaOutput({ inputPath: state.inputPath }); if ($id('outputPath')) $id('outputPath').textContent = state.outputPath || 'Chưa chọn'; }
    if (!state.outputPath) return;
    const dimensions = inputDimensions(); providerState.running = true; $id('runBtn').disabled = true; $id('progressWrap').hidden = false; $id('progressBar').style.width = '10%'; $id('progressText').textContent = 'GPT-5.4 đang phân tích ảnh...';
    try {
      const result = await window.studio.runKiraAiBetaEnhance({ inputPath: state.inputPath, outputPath: state.outputPath, options: { modelId: $id('aiModelSelect').value, prompt: $id('customPrompt')?.value.trim() || '', rebuildMode: rebuildMode(), forceCreativeRebuild: Boolean($id('forceKiraCreativeRebuild')?.checked), inputWidth: dimensions.width, inputHeight: dimensions.height } });
      $id('progressBar').style.width = '100%'; $id('progressText').textContent = 'KiraAI.vn đã hoàn tất.';
      const decision = result.analysis?.recommended_pipeline ? ` · GPT-5.4: ${result.analysis.recommended_pipeline}` : '';
      $id('resultBox').classList.remove('error'); $id('resultBox').textContent = `Đã lưu ảnh ${result.modelLabel}${decision}: ${result.outputPath}`; $id('resultBox').hidden = false; await showComparison(result.outputPath);
    } catch (error) { $id('resultBox').classList.add('error'); $id('resultBox').textContent = error.message || String(error); $id('resultBox').hidden = false; }
    finally { providerState.running = false; $id('runBtn').disabled = !state.inputPath; }
  }

  installSettings(); installProvider(); ensureNotice();
  $id('saveKiraAiKeyBtn')?.addEventListener('click', saveKey); $id('testKiraAiKeyBtn')?.addEventListener('click', testKey); $id('clearKiraAiKeyBtn')?.addEventListener('click', clearKey); $id('appSettingsBtn')?.addEventListener('click', loadStatus); $id('jobProviderSelect')?.addEventListener('change', syncUi); $id('runBtn')?.addEventListener('click', run, true);
  window.studio.onKiraAiBetaProgress?.((progress) => { if (!providerState.running) return; if (progress?.message) $id('progressText').textContent = progress.message; const values = { preparing: 5, analyzing: 25, uploading: 50, processing: 75, completed: 100 }; if (values[progress?.status]) $id('progressBar').style.width = `${values[progress.status]}%`; });
  loadStatus(); syncUi();
})();