(() => {
  const get = (id) => document.getElementById(id);
  const settings = get('vectorSettings');
  const afterImage = get('afterImage');
  if (!settings || !afterImage || !window.studio) return;

  function installStyles() {
    if (get('vectorCleanupRerunStyles')) return;
    const style = document.createElement('style');
    style.id = 'vectorCleanupRerunStyles';
    style.textContent = `
      .vector-cleanup-rerun { border: 1px solid #51466a; background: #171321; border-radius: 10px; padding: 10px; display: grid; gap: 8px; }
      .vector-cleanup-rerun-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .vector-cleanup-rerun-head strong { font-size: 11px; color: #e4dcf3; }
      .vector-cleanup-rerun small { color: #9a8faf; font-size: 9px; line-height: 1.4; }
      .vector-cleanup-rerun-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
      .vector-cleanup-rerun button { min-width: 106px; }
      .vector-cleanup-rerun-status { margin: 0; color: #b9aed0; font-size: 9px; line-height: 1.4; }
      .vector-cleanup-rerun-status.error { color: #ff9c95; }
    `;
    document.head.append(style);
  }

  function installControls() {
    if (get('vectorCleanupProfile')) return;
    const panel = document.createElement('section');
    panel.className = 'vector-cleanup-rerun';
    panel.innerHTML = `
      <div class="vector-cleanup-rerun-head">
        <strong>Tinh chỉnh Clean Vector</strong>
        <span class="smart-vector-badge">NO RETRACE</span>
      </div>
      <small>Luôn xử lý lại từ Master SVG gốc. Auto thử cả ba profile, sau đó Visual Validation so pixel để chặn biến dạng.</small>
      <div class="vector-cleanup-rerun-actions">
        <select id="vectorCleanupProfile">
          <option value="auto" selected>Auto · app tự chọn an toàn</option>
          <option value="precise">Precise · giữ chi tiết</option>
          <option value="balanced">Balanced · cân bằng</option>
          <option value="smooth">Smooth · ít node hơn</option>
        </select>
        <button id="vectorCleanupApply" class="secondary" type="button" disabled>Áp dụng</button>
      </div>
      <p id="vectorCleanupRerunStatus" class="vector-cleanup-rerun-status">Tạo SVG trước để bật tinh chỉnh.</p>
    `;
    settings.append(panel);
    get('vectorCleanupApply').addEventListener('click', rerunCleanup);
  }

  function masterPathFor(outputPath) {
    return String(outputPath || '').replace(/\.svg$/i, '.master.svg');
  }

  function setStatus(message, error = false) {
    const status = get('vectorCleanupRerunStatus');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function syncAvailability() {
    const available = state.tool === 'vector-logo' && Boolean(state.outputPath) && /\.svg$/i.test(state.outputPath);
    get('vectorCleanupApply').disabled = !available || state.busy;
    if (available && get('vectorCleanupRerunStatus').textContent === 'Tạo SVG trước để bật tinh chỉnh.') {
      setStatus('Sẵn sàng áp dụng lại cleanup từ Master SVG.');
    }
  }

  function autoSummary(autoSelection) {
    if (!autoSelection?.candidates?.length) return '';
    return autoSelection.candidates.map((candidate) => {
      const stateLabel = candidate.accepted ? `score ${candidate.score}` : `loại: ${candidate.rejectionReasons.join(', ')}`;
      return `${candidate.profile} ${candidate.nodesAfter} node · ${stateLabel}`;
    }).join(' | ');
  }

  function visualSummary(validation) {
    if (!validation || validation.skipped) return '';
    const metrics = validation.metrics;
    if (validation.preservedMaster) return 'Visual Validation: cleanup bị reject, đã giữ nguyên Master SVG.';
    if (!metrics) return validation.fallbackApplied
      ? `Visual Validation: fallback ${validation.initialProfile} → ${validation.finalProfile}.`
      : 'Visual Validation: PASS.';
    return `Visual Validation: ${validation.fallbackApplied ? `fallback ${validation.initialProfile} → ${validation.finalProfile}` : 'PASS'} · Shape IoU ${(metrics.shapeIoU * 100).toFixed(2)}% · changed pixel ${(metrics.changedPixelRatio * 100).toFixed(2)}% · color delta ${metrics.meanChannelDelta}`;
  }

  async function rerunCleanup() {
    if (state.busy || !state.outputPath) return;
    const outputPath = state.outputPath;
    const masterPath = masterPathFor(outputPath);
    const profile = get('vectorCleanupProfile').value;

    try {
      state.busy = true;
      syncAvailability();
      get('progressWrap').hidden = false;
      get('progressBar').style.width = '5%';
      get('progressText').textContent = profile === 'auto'
        ? 'Đang thử ba mức cleanup, Safety Gate và Visual Validation...'
        : 'Đang áp dụng cleanup và kiểm tra pixel với Master SVG...';
      setStatus(`Đang chạy ${profile} · không trace lại...`);

      const response = await window.studio.process({
        operation: 'vector-cleanup',
        inputPath: masterPath,
        outputPath,
        options: { profile, pathPrecision: 3 }
      });
      const payload = response?.outputPath;
      const result = typeof payload === 'object' ? payload : null;
      const cleanup = result?.vectorCleanup;
      if (!result?.outputPath) throw new Error('Cleanup service không trả về file SVG hợp lệ.');

      const selectedProfile = result.selectedProfile || cleanup?.profile || profile;
      const svgUrl = await window.studio.fileUrl(result.outputPath);
      afterImage.src = `${svgUrl}?t=${Date.now()}`;
      const validation = visualSummary(cleanup?.visualValidation);
      setStatus(cleanup
        ? `${profile === 'auto' ? `Auto chọn ${selectedProfile}` : selectedProfile}: ${cleanup.nodesBefore} → ${cleanup.nodesAfter} node · giảm ${cleanup.nodeReduction}%${validation ? ` · ${validation}` : ''}`
        : `Đã áp dụng ${selectedProfile} từ Master SVG.`);

      const resultBox = get('resultBox');
      resultBox.classList.remove('error');
      resultBox.classList.add('vector-result-lines');
      const comparison = autoSummary(cleanup?.autoSelection);
      resultBox.textContent = `Đã áp dụng cleanup ${selectedProfile} không trace lại.${profile === 'auto' ? `\nAuto recommendation: ${selectedProfile}` : ''}\nMaster: ${masterPath}\nOutput: ${result.outputPath}${cleanup ? `\nNode: ${cleanup.nodesBefore} → ${cleanup.nodesAfter} · giảm ${cleanup.nodeReduction}%` : ''}${comparison ? `\nSo profile: ${comparison}` : ''}${validation ? `\n${validation}` : ''}`;
      resultBox.hidden = false;
    } catch (error) {
      setStatus(error.message || String(error), true);
      const resultBox = get('resultBox');
      resultBox.classList.add('error');
      resultBox.textContent = `Không thể áp dụng lại cleanup: ${error.message || error}`;
      resultBox.hidden = false;
    } finally {
      state.busy = false;
      syncAvailability();
    }
  }

  installStyles();
  installControls();
  new MutationObserver(syncAvailability).observe(get('outputName'), { childList: true, characterData: true, subtree: true });
  get('toolNav')?.addEventListener('click', () => queueMicrotask(syncAvailability));
  syncAvailability();
})();
