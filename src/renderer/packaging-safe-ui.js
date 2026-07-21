(() => {
  function syncProtectionControls() {
    const enabled = $('protectionEnabled').checked;
    $('protectionSensitivitySetting').hidden = !enabled;
  }

  renderBenchmarkResults = async function renderProtectedBenchmarkResults(runResult) {
    const items = [await benchmarkItem('Ảnh gốc', state.inputPath, 'source')];
    if (state.benchmark.referencePath) {
      items.push(await benchmarkItem('Photoshop Reference', state.benchmark.referencePath, 'reference'));
    }

    for (const result of runResult.results.filter((entry) => entry.outputPath && !entry.error)) {
      items.push(await benchmarkItem(result.label, result.outputPath, result.id));
      if (result.protection?.maskPath) {
        items.push(await benchmarkItem(
          'Packaging Hybrid · Protection Mask',
          result.protection.maskPath,
          `${result.id}-protection-mask`
        ));
      }
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
          parts.push(`mask bảo vệ ${result.protection.coveragePercent}%`);
          parts.push(`độ nhạy ${result.protection.sensitivity}`);
        }
        detail.textContent = parts.join(' · ');
      }
      info.append(title, detail);

      const time = document.createElement('time');
      time.textContent = formatDuration(result.durationMs);
      row.append(info, time);
      resultList.append(row);

      if (result.protection?.maskPath) {
        const maskRow = document.createElement('div');
        maskRow.className = 'benchmark-result-row';
        maskRow.dataset.itemId = `${result.id}-protection-mask`;
        const maskInfo = document.createElement('div');
        const maskTitle = document.createElement('strong');
        maskTitle.textContent = 'Protection Mask';
        const maskDetail = document.createElement('small');
        maskDetail.textContent = 'Vùng sáng được giữ theo High Fidelity; vùng tối được phép nhận thêm Detail.';
        maskInfo.append(maskTitle, maskDetail);
        const maskCoverage = document.createElement('time');
        maskCoverage.textContent = `${result.protection.coveragePercent}%`;
        maskRow.append(maskInfo, maskCoverage);
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
      protectionSensitivity: Number($('protectionSensitivity').value)
    });

    state.benchmark.sessionDirectory = result.outputDirectory;
    state.benchmark.results = result.results;
    await renderBenchmarkResults(result);

    const successCount = result.results.filter((entry) => !entry.error && entry.outputPath).length;
    const errorCount = result.results.length - successCount;
    const hybrid = result.results.find((entry) => entry.id === 'packaging-hybrid' && entry.protection?.enabled);
    const maskMessage = hybrid
      ? ` Protection mask phủ ${hybrid.protection.coveragePercent}% ảnh.`
      : '';
    $('resultBox').classList.toggle('error', successCount === 0);
    $('resultBox').textContent = errorCount
      ? `Model Lab hoàn tất ${successCount}/${result.results.length} kết quả. Có ${errorCount} model lỗi.${maskMessage} Đã lưu tại: ${result.outputDirectory}`
      : `Model Lab hoàn tất ${successCount} kết quả.${maskMessage} Đã lưu tại: ${result.outputDirectory}`;
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
        ? 'Sẵn sàng · Packaging Safe Pro.'
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

  $('protectionEnabled').addEventListener('change', syncProtectionControls);
  bindRange('protectionSensitivity', 'protectionSensitivityValue');
  syncProtectionControls();
  refreshEngine(window.studio.getEngineStatus());
})();
