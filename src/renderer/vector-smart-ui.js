(() => {
  const get = (id) => document.getElementById(id);
  const settings = get('vectorSettings');
  const runButton = get('runBtn');
  if (!settings || !runButton || !window.studio) return;

  function installStyles() {
    if (get('smartVectorStyles')) return;
    const style = document.createElement('style');
    style.id = 'smartVectorStyles';
    style.textContent = `
      .smart-vector-notice { border-color: #496a58; background: #122019; color: #d5f2df; }
      .smart-vector-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
      .smart-vector-hint { margin: -4px 0 2px; color: #8ea49a; font-size: 9px; line-height: 1.45; }
      .smart-vector-badge { display: inline-block; margin-left: 5px; padding: 2px 6px; border-radius: 99px; background: #244433; color: #bde8c9; font-size: 8px; letter-spacing: .07em; }
      .vector-result-lines { white-space: pre-line; line-height: 1.5; }
    `;
    document.head.append(style);
  }

  function installControls() {
    if (get('vectorStrategy')) return;
    const notice = settings.querySelector('.notice');
    if (notice) {
      notice.classList.add('smart-vector-notice');
      notice.innerHTML = '<b>Smart Multi-Pass Vector</b><span class="smart-vector-badge">LOCAL</span><br>Chạy nhiều candidate, so fidelity và độ phức tạp rồi chọn SVG tốt nhất.';
    }

    const firstGroup = settings.querySelector('.setting-group');
    const controls = document.createElement('section');
    controls.className = 'smart-vector-grid';
    controls.innerHTML = `
      <div class="setting-group">
        <label for="vectorStrategy">Ưu tiên kết quả</label>
        <select id="vectorStrategy">
          <option value="smart">Smart Auto</option>
          <option value="detail">Giữ chi tiết</option>
          <option value="balanced">Cân bằng</option>
          <option value="compact">Ít node</option>
        </select>
      </div>
      <div class="setting-group">
        <label for="vectorPaletteColors">Số màu trước trace</label>
        <select id="vectorPaletteColors">
          <option value="0">Tự động</option>
          <option value="8">8 màu</option>
          <option value="12">12 màu</option>
          <option value="16">16 màu</option>
          <option value="24">24 màu</option>
          <option value="32">32 màu</option>
          <option value="48">48 màu</option>
        </select>
      </div>
    `;
    firstGroup?.before(controls);

    const cleanup = document.createElement('label');
    cleanup.className = 'check-row';
    cleanup.innerHTML = '<input id="vectorBackgroundCleanup" type="checkbox" checked><span>Tự loại nền trắng phẳng ở mép ảnh</span>';
    const invert = get('invertVector')?.closest('label');
    invert?.insertAdjacentElement('afterend', cleanup);

    const hint = document.createElement('p');
    hint.className = 'smart-vector-hint';
    hint.textContent = 'Smart Auto chạy 3 candidate. Giữ chi tiết ưu tiên fidelity; Ít node tăng mức đơn giản hóa nhưng vẫn kiểm tra lại cạnh.';
    cleanup.insertAdjacentElement('afterend', hint);

    const turd = get('turdSize');
    const turdValue = get('turdValue');
    if (turd) {
      turd.max = '12';
      turd.value = '1';
      turd.dispatchEvent(new Event('input'));
    }
    if (turdValue) turdValue.textContent = '1';

    syncModeVisibility();
    get('colorMode')?.addEventListener('change', syncModeVisibility);
  }

  function syncModeVisibility() {
    const binary = get('colorMode')?.value === 'binary';
    const thresholdGroup = get('threshold')?.closest('.setting-group');
    const invertRow = get('invertVector')?.closest('label');
    const paletteGroup = get('vectorPaletteColors')?.closest('.setting-group');
    if (thresholdGroup) thresholdGroup.hidden = !binary;
    if (invertRow) invertRow.hidden = !binary;
    if (paletteGroup) paletteGroup.hidden = binary;
  }

  function vectorOptions() {
    const paletteValue = Number(get('vectorPaletteColors')?.value || 0);
    return {
      strategy: get('vectorStrategy')?.value || 'smart',
      colorMode: get('colorMode')?.value || 'color',
      threshold: Number(get('threshold')?.value || 170),
      turdSize: Number(get('turdSize')?.value || 1),
      invert: Boolean(get('invertVector')?.checked),
      backgroundCleanup: get('vectorBackgroundCleanup')?.checked !== false,
      paletteColors: paletteValue || null
    };
  }

  async function ensureOutputPath() {
    if (state.outputPath) return state.outputPath;
    const outputPath = await window.studio.selectOutput({
      inputPath: state.inputPath,
      operation: 'vector-logo',
      format: 'png'
    });
    if (!outputPath) return null;
    state.outputPath = outputPath;
    get('outputName').textContent = outputPath.replaceAll('\\', '/').split('/').pop();
    return outputPath;
  }

  function resultText(outputPath, payload) {
    const report = payload?.vectorReport;
    const selected = report?.candidates?.find((candidate) => candidate.id === report.selectedCandidate);
    if (!report || !selected) return `Đã lưu SVG: ${outputPath}`;
    const metrics = selected.metrics || {};
    const mode = selected.label || report.selectedCandidate;
    const reportPath = payload.reportPath ? `\nBáo cáo: ${payload.reportPath}` : '';
    return [
      `Đã lưu SVG: ${outputPath}`,
      `${mode} · điểm ${report.selectedScore}/100`,
      `Fidelity ${metrics.fidelity ?? '—'}% · Edge ${metrics.edgeAgreement ?? '—'}%`,
      `${metrics.pathCount ?? '—'} path · khoảng ${metrics.nodeEstimate ?? '—'} node · ${metrics.colorCount ?? '—'} màu`,
      `Đã so ${report.candidates.length} candidate${reportPath}`
    ].join('\n');
  }

  async function runSmartVector(event) {
    if (state.tool !== 'vector-logo') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.busy || !state.inputPath) return;

    try {
      const outputPath = await ensureOutputPath();
      if (!outputPath) return;
      state.busy = true;
      runButton.disabled = true;
      get('progressWrap').hidden = false;
      get('resultBox').hidden = true;
      get('progressBar').style.width = '1%';
      get('progressText').textContent = 'Đang chuẩn bị Smart Multi-Pass Vector...';

      const response = await window.studio.process({
        operation: 'vector-logo',
        inputPath: state.inputPath,
        outputPath,
        options: vectorOptions()
      });
      const payload = response?.outputPath;
      const actualOutputPath = typeof payload === 'string' ? payload : payload?.outputPath;
      if (!actualOutputPath) throw new Error('Vector engine không trả về đường dẫn SVG hợp lệ.');
      state.outputPath = actualOutputPath;

      const resultBox = get('resultBox');
      resultBox.classList.remove('error');
      resultBox.classList.add('vector-result-lines');
      resultBox.textContent = resultText(actualOutputPath, typeof payload === 'object' ? payload : null);
      resultBox.hidden = false;

      try {
        const svgUrl = await window.studio.fileUrl(actualOutputPath);
        showComparisonUrls(state.sourceUrl, `${svgUrl}?t=${Date.now()}`);
      } catch {
        // SVG vẫn đã được lưu; preview không phải điều kiện bắt buộc.
      }
    } catch (error) {
      const resultBox = get('resultBox');
      resultBox.classList.add('error');
      resultBox.textContent = error.message || String(error);
      resultBox.hidden = false;
    } finally {
      state.busy = false;
      runButton.disabled = !state.inputPath;
    }
  }

  function syncVectorBrand(event) {
    const button = event.target.closest('.nav-item');
    if (!button || button.dataset.tool !== 'vector-logo') return;
    document.title = 'Print Upscale Studio V2.8 Smart Vector';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.8 · Smart Vector';
    get('toolDescription').textContent = 'Multi-pass local tracing, giữ chi tiết và giảm node dư bằng quality scoring.';
  }

  installStyles();
  installControls();
  runButton.addEventListener('click', runSmartVector, { capture: true });
  get('toolNav')?.addEventListener('click', syncVectorBrand);
})();
