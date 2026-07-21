(() => {
  function installPhase3Controls() {
    document.title = 'Print Upscale Studio V2.3 Semantic Guard';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.3 · Semantic Guard';
    const labNotice = document.querySelector('#benchmarkSettings .lab-notice');
    if (labNotice) {
      labNotice.innerHTML = '<b>Packaging Safe Pro V0.2 · Semantic Guard</b><span>Tách vùng giống chữ/logo khỏi texture, đồng thời kiểm tra và tự phục hồi QR/barcode khi cần.</span>';
    }
    const protectionToggle = document.querySelector('.benchmark-protection-toggle');
    if (!protectionToggle || $('semanticGuardControls')) return;

    const controls = document.createElement('div');
    controls.id = 'semanticGuardControls';
    controls.className = 'protection-grid semantic-guard-controls';
    controls.innerHTML = `
      <label class="check-row"><input id="semanticProtectionEnabled" type="checkbox" checked /><span>Text/Logo Semantic Protection</span></label>
      <label class="check-row"><input id="codeGuardEnabled" type="checkbox" checked /><span>QR & Barcode Guard</span></label>
    `;
    protectionToggle.insertAdjacentElement('afterend', controls);
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
    if (barcodeGuard.status === 'mismatch') return `${format} đọc sai nội dung`;
    if (barcodeGuard.status === 'unreadable') return `${format} không đọc được sau xử lý`;
    return `${format}: ${barcodeGuard.status}`;
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
      await appendMaskItem(
        items,
        'Packaging Hybrid · Combined Mask',
        result.protection?.maskPath,
        `${result.id}-protection-mask`
      );
      await appendMaskItem(
        items,
        'Text/Logo Semantic Mask',
        result.protection?.semantic?.maskPath,
        `${result.id}-semantic-mask`
      );
      await appendMaskItem(
        items,
        'QR/Barcode Guard Mask',
        result.protection?.barcode?.maskPath,
        `${result.id}-barcode-mask`
      );
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
    const preferredAfter = ['packaging-hybrid', 'official-detail', 'current-packaging', 'current-photo']
      .find((id) => items.some((item) => item.id === id));
    afterSelect.value = preferredAfter || items.find((item) => item.id !== beforeSelect.value)?.id || beforeSelect.value;

    const resultList = $('benchmarkResultList');
    resultList.replaceChildren();
    for (const result of runResult.results) {
      const row = document.createElement('div');
      row.className = `benchmark-result-row${result.error ? ' error' : ''}`;
      if (!result.error) row.dataset.itemId = result.id;

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = result.label;
      const detail = document.createElement('small');
      if (result.error) {
        detail.textContent = result.error;
      } else {
        const parts = [
          `${result.metadata?.width || '—'} × ${result.metadata?.height || '—'} px`,
          formatBytes(result.metadata?.sizeBytes)
        ];
        if (result.protection?.enabled) {
          parts.push(`combined mask ${result.protection.coveragePercent}%`);
          if (result.protection.semantic?.enabled) {
            parts.push(`text/logo ${result.protection.semantic.coveragePercent}%`);
          }
        }
        const codeText = barcodeStatusText(result.barcodeGuard);
        if (codeText) parts.push(codeText);
        detail.textContent = parts.join(' · ');
      }
      info.append(title, detail);

      const time = document.createElement('time');
      time.textContent = formatDuration(result.durationMs);
      row.append(info, time);
      resultList.append(row);

      const maskRows = [
        {
          id: `${result.id}-protection-mask`,
          title: 'Combined Protection Mask',
          detail: 'Tổng hợp cạnh hình học, vùng text/logo và vùng mã.',
          value: result.protection?.coveragePercent,
          path: result.protection?.maskPath
        },
        {
          id: `${result.id}-semantic-mask`,
          title: 'Text/Logo Semantic Mask',
          detail: 'Vùng chữ/logo ước lượng theo mật độ nét, hướng stroke và độ phẳng cục bộ.',
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
      codeGuardEnabled: $('codeGuardEnabled').checked
    });

    state.benchmark.sessionDirectory = result.outputDirectory;
    state.benchmark.results = result.results;
    await renderBenchmarkResults(result);

    const successCount = result.results.filter((entry) => !entry.error && entry.outputPath).length;
    const errorCount = result.results.length - successCount;
    const hybrid = result.results.find((entry) => entry.id === 'packaging-hybrid' && entry.protection?.enabled);
    const maskMessage = hybrid
      ? ` Combined mask phủ ${hybrid.protection.coveragePercent}% ảnh.`
      : '';
    const codeMessage = barcodeStatusText(hybrid?.barcodeGuard);
    const guardMessage = codeMessage ? ` Code Guard: ${codeMessage}.` : '';
    const codeFailed = hybrid?.barcodeGuard
      && ['mismatch', 'unreadable'].includes(hybrid.barcodeGuard.status);
    $('resultBox').classList.toggle('error', successCount === 0 || Boolean(codeFailed));
    $('resultBox').textContent = errorCount
      ? `Model Lab hoàn tất ${successCount}/${result.results.length} kết quả. Có ${errorCount} model lỗi.${maskMessage}${guardMessage} Đã lưu tại: ${result.outputDirectory}`
      : `Model Lab hoàn tất ${successCount} kết quả.${maskMessage}${guardMessage} Đã lưu tại: ${result.outputDirectory}`;
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
        ? 'Sẵn sàng · Semantic Guard + Code Guard.'
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

  installPhase3Controls();
  $('protectionEnabled').addEventListener('change', syncProtectionControls);
  bindRange('protectionSensitivity', 'protectionSensitivityValue');
  syncProtectionControls();
  refreshEngine(window.studio.getEngineStatus());
})();
