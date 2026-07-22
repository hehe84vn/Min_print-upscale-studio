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
      .geometry-lock-row, .binary-reconstruction-row { border: 1px solid #345542; background: #101b15; border-radius: 9px; padding: 9px; }
      .binary-reconstruction-row { border-color: #53683d; background: #171d10; }
    `;
    document.head.append(style);
  }

  function installControls() {
    if (get('vectorStrategy')) return;
    const notice = settings.querySelector('.notice');
    if (notice) {
      notice.classList.add('smart-vector-notice');
      notice.innerHTML = '<b>Smart Vector</b><span class="smart-vector-badge">INPUT QUALITY GATE</span><br>Ảnh quá mờ, quá nhỏ hoặc mất dữ liệu hình học sẽ bị chặn trước khi chạy engine trace.';
    }

    const colorMode = get('colorMode');
    if (colorMode?.options?.[0]) colorMode.options[0].textContent = 'Tự động / màu phẳng';
    if (colorMode?.options?.[1]) colorMode.options[1].textContent = 'Ép đơn sắc';

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
    cleanup.innerHTML = '<input id="vectorBackgroundCleanup" type="checkbox" checked><span>Tự loại nền trắng phẳng ở mép ảnh màu</span>';
    const invert = get('invertVector')?.closest('label');
    invert?.insertAdjacentElement('afterend', cleanup);

    const geometryLock = document.createElement('label');
    geometryLock.className = 'check-row geometry-lock-row';
    geometryLock.innerHTML = '<input id="vectorGeometryLock" type="checkbox" checked><span>Geometry Lock: giữ góc, snap cạnh ngang/dọc và đổi Bézier gần thẳng thành line</span>';
    cleanup.insertAdjacentElement('afterend', geometryLock);

    const reconstruction = document.createElement('label');
    reconstruction.className = 'check-row binary-reconstruction-row';
    reconstruction.innerHTML = '<input id="vectorBinaryReconstruction" type="checkbox" checked><span>Hybrid Contour Reconstruction: polygon cho cạnh thẳng, Bézier cho contour cong</span>';
    geometryLock.insertAdjacentElement('afterend', reconstruction);

    const hint = document.createElement('p');
    hint.className = 'smart-vector-hint';
    hint.textContent = 'Input Quality Gate đo vùng logo thực, độ nét cạnh, transition width, nét nhỏ nhất, tương phản và JPEG artifact trước khi trace.';
    reconstruction.insertAdjacentElement('afterend', hint);

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
    const cleanupRow = get('vectorBackgroundCleanup')?.closest('label');
    if (thresholdGroup) thresholdGroup.hidden = !binary;
    if (invertRow) invertRow.hidden = !binary;
    if (paletteGroup) paletteGroup.hidden = binary;
    if (cleanupRow) cleanupRow.hidden = binary;
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
      geometryLock: get('vectorGeometryLock')?.checked !== false,
      binaryReconstruction: get('vectorBinaryReconstruction')?.checked !== false,
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
    const lock = selected.geometryLock || {};
    const reconstruction = selected.reconstruction || {};
    const component = metrics.componentValidation || {};
    const input = report.inputQuality || {};
    const inputGate = input.gate || {};
    const mode = selected.label || report.selectedCandidate;
    const sourceMode = report.autoMonochrome
      ? `Tự nhận diện đơn sắc ${report.source?.analysis?.confidence ?? '—'}%`
      : report.effectiveColorMode === 'binary'
        ? 'Đơn sắc'
        : 'Màu';
    const reportPath = payload.reportPath ? `\nBáo cáo: ${payload.reportPath}` : '';
    const inputLine = inputGate.status
      ? `Input ${String(inputGate.status).toUpperCase()} ${inputGate.score}/100 · logo ${input.logoBounds?.width ?? '—'}×${input.logoBounds?.height ?? '—'} px · sharp ${input.edge?.sharpnessScore ?? '—'} · stroke ${input.stroke?.minimumStrokePx ?? '—'} px`
      : null;
    const geometryLine = report.effectiveColorMode === 'binary'
      ? `Corner ${metrics.cornerPreservation ?? '—'}% · Straight ${metrics.straightnessScore ?? '—'}% · Axis ${metrics.axisAgreement ?? '—'}%`
      : `Fidelity ${metrics.fidelity ?? '—'}% · Edge ${metrics.edgeAgreement ?? '—'}%`;
    const componentLine = report.effectiveColorMode === 'binary'
      ? `Component: worst ${component.worstComponentIoU ?? '—'}% · P10 ${component.p10ComponentIoU ?? '—'}% · weighted ${component.weightedComponentIoU ?? '—'}%`
      : null;
    const cleanupLine = report.geometryLockEnabled && selected.geometryLock
      ? `Geometry Lock: ${lock.curvesConvertedToLines ?? 0} curve→line · ${lock.axisSnaps ?? 0} snap · bỏ ${lock.collinearNodesRemoved ?? 0} node thẳng hàng`
      : null;
    const reconstructionLine = selected.reconstruction
      ? `Reconstruction: ${reconstruction.loopCount ?? 0} contour · giảm node ${reconstruction.nodeReductionPercent ?? 0}% · polygon ${reconstruction.polygonLoops ?? reconstruction.rectilinearLoops ?? 0} · curve ${reconstruction.curveLoops ?? 0}`
      : null;
    const quality = report.qualityGate?.status === 'pass' ? 'PASS' : 'REVIEW';
    return [
      `Đã lưu SVG: ${outputPath}`,
      inputLine,
      `${quality} · ${mode} · điểm ${report.selectedScore}/100 · ${sourceMode}`,
      `Fidelity ${metrics.fidelity ?? '—'}% · Edge ${metrics.edgeAgreement ?? '—'}%`,
      geometryLine,
      componentLine,
      `${metrics.pathCount ?? '—'} path · khoảng ${metrics.nodeEstimate ?? '—'} node · ${metrics.colorCount ?? '—'} màu`,
      reconstructionLine,
      cleanupLine,
      `Đã so ${report.candidates.length} candidate${reportPath}`
    ].filter(Boolean).join('\n');
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
      get('progressText').textContent = 'Đang kiểm tra độ nét, kích thước logo và JPEG artifact...';

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
      resultBox.classList.toggle('error', payload?.vectorReport?.qualityGate?.status !== 'pass');
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
      resultBox.classList.add('vector-result-lines');
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
    document.title = 'Print Upscale Studio V2.8.4 Input Quality Gate';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.8.4 · Input Quality Gate';
    get('toolDescription').textContent = 'Chặn ảnh quá mờ trước trace; sau đó mới chạy Smart Vector candidates.';
  }

  installStyles();
  installControls();
  runButton.addEventListener('click', runSmartVector, { capture: true });
  get('toolNav')?.addEventListener('click', syncVectorBrand);
})();