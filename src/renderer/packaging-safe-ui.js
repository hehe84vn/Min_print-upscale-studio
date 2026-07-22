(() => {
  const STATUS_LABELS = {
    pass: 'PASS',
    warning: 'WARNING',
    fail: 'FAIL',
    skipped: 'N/A'
  };

  function installPhase4Styles() {
    if ($('preflightPhaseStyles')) return;
    const style = document.createElement('style');
    style.id = 'preflightPhaseStyles';
    style.textContent = `
      .preflight-toggle { margin: 10px 0 14px; padding: 11px; border: 1px solid #37512b; border-radius: 10px; background: #141d12; }
      .preflight-toggle input { accent-color: var(--accent); }
      .result-title-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .preflight-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 58px; padding: 3px 7px; border-radius: 999px; font-size: 8px; font-weight: 900; letter-spacing: .08em; border: 1px solid transparent; }
      .preflight-badge.pass { color: #cfff91; background: #182414; border-color: #3c5f2b; }
      .preflight-badge.warning { color: #ffd989; background: #292112; border-color: #6d5522; }
      .preflight-badge.fail { color: #ffabb4; background: #2b171a; border-color: #71343b; }
      .preflight-badge.skipped { color: #aeb5be; background: #20242a; border-color: #3a414a; }
      .preflight-result-row { border-left: 3px solid #4a515b; background: #101318; }
      .preflight-result-row.pass { border-left-color: #7fbd3c; }
      .preflight-result-row.warning { border-left-color: #d4a53b; }
      .preflight-result-row.fail { border-left-color: #e25d68; background: #231619; }
      .preflight-result-row time { font-weight: 900; }
      .preflight-result-row.pass time { color: #bfff79; }
      .preflight-result-row.warning time { color: #ffd37b; }
      .preflight-result-row.fail time { color: #ff9da7; }
    `;
    document.head.append(style);
  }

  function installPhase4Controls() {
    document.title = 'Print Upscale Studio V2.4 Packaging Preflight';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.4 · Packaging Preflight';
    const labNotice = document.querySelector('#benchmarkSettings .lab-notice');
    if (labNotice) {
      labNotice.innerHTML = '<b>Packaging Safe Pro V0.4 · Auto Validation</b><span>Tự kiểm tra QR/barcode, màu, hình học, text/logo, halo và mức phủ mask cho từng kết quả.</span>';
    }

    const protectionToggle = document.querySelector('.benchmark-protection-toggle');
    if (!protectionToggle) return;

    if (!$('semanticGuardControls')) {
      const controls = document.createElement('div');
      controls.id = 'semanticGuardControls';
      controls.className = 'protection-grid semantic-guard-controls';
      controls.innerHTML = `
        <label class="check-row"><input id="semanticProtectionEnabled" type="checkbox" checked /><span>Text/Logo Semantic Protection</span></label>
        <label class="check-row"><input id="codeGuardEnabled" type="checkbox" checked /><span>QR & Barcode Guard</span></label>
      `;
      protectionToggle.insertAdjacentElement('afterend', controls);
    }

    if (!$('preflightEnabled')) {
      const preflightToggle = document.createElement('label');
      preflightToggle.className = 'check-row preflight-toggle';
      preflightToggle.innerHTML = '<input id="preflightEnabled" type="checkbox" checked /><span>Packaging Preflight & Auto Validation</span>';
      $('semanticGuardControls').insertAdjacentElement('afterend', preflightToggle);
    }

    installPhase4Styles();
  }

  function syncProtectionControls() {
    const enabled = $('protectionEnabled').checked;
    $('protectionSensitivitySetting').hidden = !enabled;
    $('semanticGuardControls').hidden = !enabled;
    $('semanticProtectionEnabled').disabled = !enabled;
    $('codeGuardEnabled').disabled = !enabled;
  }

  function barcodeStatusText(barcodeGuard) {
    if (!barcodeGuard || barcodeGuard.status === 'disabled') return null;
    if (barcodeGuard.status === 'not-detected') return 'không phát hiện QR/barcode';
    const format = barcodeGuard.source?.format || 'mã';
    if (barcodeGuard.status === 'pass' && barcodeGuard.restored) return `${format} đã tự phục hồi và đọc lại thành công`;
    if (barcodeGuard.status === 'pass') return `${format} đọc tốt`;
    if (barcodeGuard.status === 'visual-pass') return 'vùng barcode-like vẫn được bảo vệ, chưa xác thực checksum';
    if (barcodeGuard.status === 'visual-unreadable') return 'vùng barcode-like không còn được phát hiện';
    if (barcodeGuard.status === 'mismatch') return `${format} đọc sai nội dung`;
    if (barcodeGuard.status === 'unreadable') return `${format} không đọc được sau xử lý`;
    return `${format}: ${barcodeGuard.status}`;
  }

  function statusBadge(status) {
    const badge = document.createElement('span');
    const safeStatus = STATUS_LABELS[status] ? status : 'skipped';
    badge.className = `preflight-badge ${safeStatus}`;
    badge.textContent = STATUS_LABELS[safeStatus];
    return badge;
  }

  function metricStatus(metric) {
    return STATUS_LABELS[metric?.status] || 'N/A';
  }

  function preflightDetail(preflight) {
    if (!preflight) return 'Preflight không được bật.';
    if (preflight.error) return `Preflight lỗi: ${preflight.error}`;
    const metrics = preflight.metrics || {};
    const parts = [];
    if (metrics.barcode?.status !== 'skipped') parts.push(`Code ${metricStatus(metrics.barcode)}`);
    if (metrics.color) parts.push(`Màu ΔE ${metrics.color.meanDeltaE76 ?? '—'} · ${metricStatus(metrics.color)}`);
    if (metrics.geometry) parts.push(`Hình học ${metrics.geometry.agreementPercent ?? '—'}% · ${metricStatus(metrics.geometry)}`);
    if (metrics.textLogo?.status !== 'skipped') parts.push(`Text/Logo ${metrics.textLogo.agreementPercent ?? '—'}% · ${metricStatus(metrics.textLogo)}`);
    if (metrics.halo) parts.push(`Halo ${metrics.halo.edgeGainP90 ?? '—'}×/${metrics.halo.ringingPercent ?? '—'}% · ${metricStatus(metrics.halo)}`);
    if (metrics.maskCoverage?.status !== 'skipped') parts.push(`Mask ${metrics.maskCoverage.coveragePercent ?? '—'}% · ${metricStatus(metrics.maskCoverage)}`);
    return parts.join(' · ');
  }

  async function appendMaskItem(items, label, pathValue, id) {
    if (!pathValue) return;
    items.push(await benchmarkItem(label, pathValue, id));
  }

  renderBenchmarkResults = async function renderProtectedBenchmarkResults(runResult) {
    const items = [await benchmarkItem('Ảnh gốc', state.inputPath, 'source')];
    if (state.benchmark.referencePath) {
      items.push(await benchmarkItem('Photoshop Reference', state.benchmark.referencePath, 'reference'));
    }

    for (const result of runResult.results.filter((entry) => entry.outputPath && !entry.error)) {
      items.push(await benchmarkItem(result.label, result.outputPath, result.id));
      await appendMaskItem(items, 'Packaging Hybrid · Refined Combined Mask', result.protection?.maskPath, `${result.id}-protection-mask`);
      await appendMaskItem(items, 'Text/Logo Refined Semantic Mask', result.protection?.semantic?.maskPath, `${result.id}-semantic-mask`);
      await appendMaskItem(items, 'QR/Barcode Guard Mask', result.protection?.barcode?.maskPath, `${result.id}-barcode-mask`);
    }
    state.benchmark.items = items;

    const beforeSelect = $('benchmarkBeforeSelect');
    const afterSelect = $('benchmarkAfterSelect');
    beforeSelect.replaceChildren();
    afterSelect.replaceChildren();
    for (const item of items) {
      for (const select of [beforeSelect, afterSelect]) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        select.append(option);
      }
    }

    beforeSelect.value = items.some((item) => item.id === 'reference') ? 'reference' : 'source';
    const preferredAfter = ['packaging-hybrid', 'current-packaging', 'current-photo', 'official-detail']
      .find((id) => items.some((item) => item.id === id));
    afterSelect.value = preferredAfter || items.find((item) => item.id !== beforeSelect.value)?.id || beforeSelect.value;

    const resultList = $('benchmarkResultList');
    resultList.replaceChildren();
    for (const result of runResult.results) {
      const row = document.createElement('div');
      row.className = `benchmark-result-row${result.error ? ' error' : ''}`;
      if (!result.error) row.dataset.itemId = result.id;

      const info = document.createElement('div');
      const titleLine = document.createElement('div');
      titleLine.className = 'result-title-line';
      const title = document.createElement('strong');
      title.textContent = result.label;
      titleLine.append(title);
      if (result.preflight) titleLine.append(statusBadge(result.preflight.status));

      const detail = document.createElement('small');
      if (result.error) {
        detail.textContent = result.error;
      } else {
        const parts = [`${result.metadata?.width || '—'} × ${result.metadata?.height || '—'} px`, formatBytes(result.metadata?.sizeBytes)];
        if (result.protection?.enabled) {
          parts.push(`refined mask ${result.protection.coveragePercent}%`);
          if (result.protection.semantic?.enabled) parts.push(`text/logo ${result.protection.semantic.coveragePercent}%`);
        }
        const codeText = barcodeStatusText(result.barcodeGuard);
        if (codeText) parts.push(codeText);
        detail.textContent = parts.join(' · ');
      }
      info.append(titleLine, detail);

      const time = document.createElement('time');
      time.textContent = formatDuration(result.durationMs);
      row.append(info, time);
      resultList.append(row);

      if (result.preflight) {
        const preflightRow = document.createElement('div');
        const status = STATUS_LABELS[result.preflight.status] ? result.preflight.status : 'warning';
        preflightRow.className = `benchmark-result-row preflight-result-row ${status}`;
        preflightRow.dataset.itemId = result.id;
        const preflightInfo = document.createElement('div');
        const preflightTitleLine = document.createElement('div');
        preflightTitleLine.className = 'result-title-line';
        const preflightTitle = document.createElement('strong');
        preflightTitle.textContent = 'Packaging Preflight';
        preflightTitleLine.append(preflightTitle, statusBadge(status));
        const preflightText = document.createElement('small');
        preflightText.textContent = preflightDetail(result.preflight);
        preflightInfo.append(preflightTitleLine, preflightText);
        const score = document.createElement('time');
        score.textContent = Number.isFinite(result.preflight.score) ? `${result.preflight.score}/100` : 'CHECK';
        preflightRow.append(preflightInfo, score);
        resultList.append(preflightRow);
      }

      const maskRows = [
        {
          id: `${result.id}-protection-mask`,
          title: 'Refined Combined Protection Mask',
          detail: 'Tổng hợp cạnh hình học, vùng text/logo và vùng mã; đã nối nét và feather biên.',
          value: result.protection?.coveragePercent,
          path: result.protection?.maskPath
        },
        {
          id: `${result.id}-semantic-mask`,
          title: 'Refined Text/Logo Semantic Mask',
          detail: 'Vùng chữ/logo theo cạnh thật ở độ phân giải cao.',
          value: result.protection?.semantic?.coveragePercent,
          path: result.protection?.semantic?.maskPath
        },
        {
          id: `${result.id}-barcode-mask`,
          title: 'QR/Barcode Guard Mask',
          detail: barcodeStatusText(result.barcodeGuard) || 'Vùng QR/barcode được khóa theo ảnh nguồn.',
          value: result.protection?.barcode?.detection?.format || 'CODE',
          path: result.protection?.barcode?.maskPath
        }
      ];

      for (const mask of maskRows.filter((entry) => entry.path)) {
        const maskRow = document.createElement('div');
        maskRow.className = 'benchmark-result-row';
        maskRow.dataset.itemId = mask.id;
        const maskInfo = document.createElement('div');
        const maskTitle = document.createElement('strong');
        maskTitle.textContent = mask.title;
        const maskDetail = document.createElement('small');
        maskDetail.textContent = mask.detail;
        maskInfo.append(maskTitle, maskDetail);
        const maskValue = document.createElement('time');
        maskValue.textContent = typeof mask.value === 'number' ? `${mask.value}%` : mask.value;
        maskRow.append(maskInfo, maskValue);
        resultList.append(maskRow);
      }
    }

    $('benchmarkFolderName').textContent = runResult.outputDirectory;
    $('benchmarkSummaryCard').hidden = false;
    await updateBenchmarkComparison();
  };

  runBenchmarkLab = async function runProtectedBenchmarkLab() {
    if (!state.benchmark.outputRoot) await chooseOutput();
    if (!state.benchmark.outputRoot) return;

    const presetIds = selectedBenchmarkPresetIds();
    if (!presetIds.length) throw new Error('Chọn ít nhất một model trong Model Lab.');

    const result = await window.studio.runBenchmark({
      inputPath: state.inputPath,
      outputDirectory: state.benchmark.outputRoot,
      referencePath: state.benchmark.referencePath,
      presetIds,
      scale: Number($('scaleSelect').value),
      dpi: Number($('dpiSelect').value),
      blendStrength: Number($('blendStrength').value) / 100,
      protectionEnabled: $('protectionEnabled').checked,
      protectionSensitivity: Number($('protectionSensitivity').value),
      semanticProtectionEnabled: $('semanticProtectionEnabled').checked,
      codeGuardEnabled: $('codeGuardEnabled').checked,
      preflightEnabled: $('preflightEnabled').checked
    });

    state.benchmark.sessionDirectory = result.outputDirectory;
    state.benchmark.results = result.results;
    await renderBenchmarkResults(result);

    const successCount = result.results.filter((entry) => !entry.error && entry.outputPath).length;
    const errorCount = result.results.length - successCount;
    const hybrid = result.results.find((entry) => entry.id === 'packaging-hybrid' && entry.protection?.enabled);
    const maskMessage = hybrid ? ` Refined mask phủ ${hybrid.protection.coveragePercent}% ảnh.` : '';
    const codeMessage = barcodeStatusText(hybrid?.barcodeGuard);
    const guardMessage = codeMessage ? ` Code Guard: ${codeMessage}.` : '';
    const summary = result.preflightSummary || { pass: 0, warning: 0, fail: 0 };
    const preflightMessage = $('preflightEnabled').checked
      ? ` Preflight: ${summary.pass} PASS · ${summary.warning} WARNING · ${summary.fail} FAIL.`
      : '';
    const hasFail = summary.fail > 0;
    $('resultBox').classList.toggle('error', successCount === 0 || hasFail);
    $('resultBox').textContent = errorCount
      ? `Model Lab hoàn tất ${successCount}/${result.results.length} kết quả. Có ${errorCount} model lỗi.${maskMessage}${guardMessage}${preflightMessage} Đã lưu tại: ${result.outputDirectory}`
      : `Model Lab hoàn tất ${successCount} kết quả.${maskMessage}${guardMessage}${preflightMessage} Đã lưu tại: ${result.outputDirectory}`;
    $('resultBox').hidden = false;
  };

  refreshEngine = async function refreshPackagingEngine(statusPromise) {
    const status = await statusPromise;
    state.engine = status;
    const ready = status.configured && status.availableModels.length > 0;
    const labReady = status.availableModels.includes('realesrgan-x4plus');
    $('engineDot').classList.toggle('online', ready);
    $('engineStatus').textContent = ready
      ? labReady
        ? 'Sẵn sàng · Mask Refinement + Packaging Preflight.'
        : 'Sẵn sàng xử lý local. Thiếu RealESRGAN Detail.'
      : 'Chế độ tương thích đang khả dụng.';

    [...$('modelSelect').options].forEach((option) => {
      option.disabled = status.configured && !status.availableModels.includes(option.value);
    });

    document.querySelectorAll('.benchmark-preset').forEach((input) => {
      const requiredModels = String(input.dataset.models || '').split(',').filter(Boolean);
      const available = requiredModels.every((model) => status.availableModels.includes(model));
      input.disabled = status.configured && !available;
      input.closest('.benchmark-option')?.setAttribute(
        'title',
        available ? '' : `Thiếu model: ${requiredModels.filter((model) => !status.availableModels.includes(model)).join(', ')}`
      );
    });
  };

  installPhase4Controls();
  $('protectionEnabled').addEventListener('change', syncProtectionControls);
  bindRange('protectionSensitivity', 'protectionSensitivityValue');
  syncProtectionControls();
  refreshEngine(window.studio.getEngineStatus());
})();
