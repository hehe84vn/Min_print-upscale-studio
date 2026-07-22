(() => {
  const LABELS = {
    pass: 'PASS',
    warning: 'REVIEW',
    fail: 'RISK',
    skipped: 'N/A'
  };

  function installCompactStyles() {
    if ($('compactResultsStyles')) return;
    const style = document.createElement('style');
    style.id = 'compactResultsStyles';
    style.textContent = `
      .benchmark-result-list { gap: 9px; }
      .compact-results-toolbar { display: flex; justify-content: flex-end; gap: 7px; margin: 10px 0 2px; }
      .compact-results-toolbar button { padding: 6px 9px; font-size: 9px; }
      .model-result-group { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #101318; }
      .model-result-group[open] { border-color: #3b4552; }
      .model-result-summary { list-style: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 12px; cursor: pointer; user-select: none; }
      .model-result-summary::-webkit-details-marker { display: none; }
      .model-result-summary:hover { background: #141920; }
      .model-summary-main { min-width: 0; }
      .model-summary-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
      .model-summary-title strong { font-size: 12px; color: #e2e7ed; }
      .model-summary-meta { display: block; margin-top: 4px; color: #8893a1; font-size: 9px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .model-summary-side { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
      .model-summary-time { color: var(--lab); font-size: 10px; }
      .model-summary-chevron { color: #718096; font-size: 12px; transition: transform .18s ease; }
      .model-result-group[open] .model-summary-chevron { transform: rotate(90deg); }
      .model-result-details { display: grid; gap: 6px; padding: 0 9px 9px; border-top: 1px solid #252c35; }
      .model-result-details .benchmark-result-row { padding: 8px 9px; border-radius: 8px; }
      .model-result-details .benchmark-result-row strong { font-size: 10px; }
      .model-result-details .benchmark-result-row small { margin-top: 3px; font-size: 9px; line-height: 1.35; }
      .model-result-details .benchmark-result-row time { font-size: 9px; }
      .compact-path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .model-result-group.error { border-color: #65353c; }
      .model-result-group.error .model-result-summary { background: #211518; }
      .compact-empty-detail { padding: 9px 10px; color: var(--muted); font-size: 9px; }
    `;
    document.head.append(style);
  }

  function badge(status) {
    const safe = LABELS[status] ? status : 'skipped';
    const element = document.createElement('span');
    element.className = `preflight-badge ${safe}`;
    element.textContent = LABELS[safe];
    return element;
  }

  function metricStatus(metric) {
    return LABELS[metric?.status] || 'N/A';
  }

  function qualityText(check) {
    if (!check) return 'Quality Check không được bật.';
    if (check.error) return `Quality Check lỗi: ${check.error}`;
    const metrics = check.metrics || {};
    const parts = [];
    if (metrics.barcode?.status !== 'skipped') parts.push(`Code ${metricStatus(metrics.barcode)}`);
    if (metrics.color) parts.push(`RGB ΔE ${metrics.color.meanDeltaE76 ?? '—'} · ${metricStatus(metrics.color)}`);
    if (metrics.geometry) parts.push(`Hình học ${metrics.geometry.agreementPercent ?? '—'}% · ${metricStatus(metrics.geometry)}`);
    if (metrics.textLogo?.status !== 'skipped') parts.push(`Text/Logo ${metrics.textLogo.agreementPercent ?? '—'}% · ${metricStatus(metrics.textLogo)}`);
    if (metrics.halo) parts.push(`Halo ${metrics.halo.edgeGainP90 ?? '—'}×/${metrics.halo.ringingPercent ?? '—'}% · ${metricStatus(metrics.halo)}`);
    if (metrics.maskCoverage?.status !== 'skipped') parts.push(`Mask ${metrics.maskCoverage.coveragePercent ?? '—'}% · ${metricStatus(metrics.maskCoverage)}`);
    return parts.join(' · ');
  }

  function barcodeText(barcodeGuard) {
    if (!barcodeGuard || barcodeGuard.status === 'disabled') return null;
    if (barcodeGuard.status === 'not-detected') return 'không phát hiện QR/barcode';
    const format = barcodeGuard.source?.format || 'mã';
    if (barcodeGuard.status === 'pass' && barcodeGuard.restored) return `${format} đã tự phục hồi`;
    if (barcodeGuard.status === 'pass') return `${format} đọc tốt`;
    if (barcodeGuard.status === 'visual-pass') return 'barcode-like được bảo vệ';
    if (barcodeGuard.status === 'visual-unreadable') return 'barcode-like không còn được phát hiện';
    if (barcodeGuard.status === 'mismatch') return `${format} đọc sai nội dung`;
    if (barcodeGuard.status === 'unreadable') return `${format} không đọc được`;
    return `${format}: ${barcodeGuard.status}`;
  }

  function row({ title, detail, value, className = '', itemId = null, pathTitle = null }) {
    const element = document.createElement('div');
    element.className = `benchmark-result-row ${className}`.trim();
    if (itemId) element.dataset.itemId = itemId;

    const info = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const description = document.createElement('small');
    description.textContent = detail;
    if (pathTitle) {
      description.classList.add('compact-path');
      description.title = pathTitle;
    }
    info.append(heading, description);

    const trailing = document.createElement('time');
    trailing.textContent = value;
    element.append(info, trailing);
    return element;
  }

  function qualityRow(result) {
    if (!result.preflight) return null;
    const status = LABELS[result.preflight.status] ? result.preflight.status : 'warning';
    const element = document.createElement('div');
    element.className = `benchmark-result-row preflight-result-row ${status}`;
    element.dataset.itemId = result.id;

    const info = document.createElement('div');
    const titleLine = document.createElement('div');
    titleLine.className = 'result-title-line';
    const title = document.createElement('strong');
    title.textContent = 'Upscale Quality Check';
    titleLine.append(title, badge(status));
    const detail = document.createElement('small');
    detail.textContent = qualityText(result.preflight);
    info.append(titleLine, detail);

    const score = document.createElement('time');
    score.textContent = Number.isFinite(result.preflight.score) ? `${result.preflight.score}/100` : 'CHECK';
    element.append(info, score);
    return element;
  }

  function cmykRow(result) {
    if (!result.cmykOutput) return null;
    const failed = Boolean(result.cmykOutput.error);
    const outputPath = result.cmykOutput.outputPath || '';
    return row({
      title: 'CMYK TIFF Copy',
      detail: failed
        ? `Không tạo được CMYK: ${result.cmykOutput.error}`
        : `${result.cmykOutput.profile?.label || 'ICC profile'} · TIFF 8-bit LZW · ${fileName(outputPath)}`,
      value: failed ? 'ERROR' : 'CMYK',
      className: `cmyk-result-row${failed ? ' error' : ''}`,
      pathTitle: failed ? null : outputPath
    });
  }

  function maskRows(result) {
    const values = [
      {
        id: `${result.id}-protection-mask`,
        title: 'Combined Protection Mask',
        detail: 'Cạnh hình học, text/logo và vùng mã; đã nối nét và feather biên.',
        value: result.protection?.coveragePercent,
        path: result.protection?.maskPath
      },
      {
        id: `${result.id}-semantic-mask`,
        title: 'Text/Logo Semantic Mask',
        detail: 'Vùng chữ và logo theo cạnh thật ở độ phân giải cao.',
        value: result.protection?.semantic?.coveragePercent,
        path: result.protection?.semantic?.maskPath
      },
      {
        id: `${result.id}-barcode-mask`,
        title: 'QR/Barcode Guard Mask',
        detail: barcodeText(result.barcodeGuard) || 'Vùng QR/barcode được khóa theo ảnh nguồn.',
        value: result.protection?.barcode?.detection?.format || 'CODE',
        path: result.protection?.barcode?.maskPath
      }
    ];

    return values.filter((entry) => entry.path).map((entry) => row({
      title: entry.title,
      detail: entry.detail,
      value: typeof entry.value === 'number' ? `${entry.value}%` : entry.value,
      itemId: entry.id
    }));
  }

  function summaryMeta(result) {
    if (result.error) return result.error;
    const parts = [
      `${result.metadata?.width || '—'} × ${result.metadata?.height || '—'} px`,
      formatBytes(result.metadata?.sizeBytes)
    ];
    if (result.preflight) parts.push(`Quality ${LABELS[result.preflight.status] || 'CHECK'}${Number.isFinite(result.preflight.score) ? ` ${result.preflight.score}/100` : ''}`);
    if (result.cmykOutput?.outputPath) parts.push('CMYK ✓');
    if (result.cmykOutput?.error) parts.push('CMYK lỗi');
    if (result.protection?.enabled) parts.push(`Mask ${result.protection.coveragePercent}%`);
    return parts.join(' · ');
  }

  function createModelGroup(result) {
    const group = document.createElement('details');
    group.className = `model-result-group${result.error ? ' error' : ''}`;
    group.open = Boolean(result.error || result.preflight?.status === 'fail' || result.cmykOutput?.error);

    const summary = document.createElement('summary');
    summary.className = 'model-result-summary';
    if (!result.error) summary.dataset.itemId = result.id;

    const main = document.createElement('div');
    main.className = 'model-summary-main';
    const titleLine = document.createElement('div');
    titleLine.className = 'model-summary-title';
    const title = document.createElement('strong');
    title.textContent = result.label;
    titleLine.append(title);
    if (result.preflight) titleLine.append(badge(result.preflight.status));
    const meta = document.createElement('small');
    meta.className = 'model-summary-meta';
    meta.textContent = summaryMeta(result);
    main.append(titleLine, meta);

    const side = document.createElement('div');
    side.className = 'model-summary-side';
    const time = document.createElement('time');
    time.className = 'model-summary-time';
    time.textContent = formatDuration(result.durationMs);
    const chevron = document.createElement('span');
    chevron.className = 'model-summary-chevron';
    chevron.textContent = '›';
    side.append(time, chevron);
    summary.append(main, side);
    group.append(summary);

    const details = document.createElement('div');
    details.className = 'model-result-details';
    const children = [];
    const check = qualityRow(result);
    const cmyk = cmykRow(result);
    if (check) children.push(check);
    if (cmyk) children.push(cmyk);
    children.push(...maskRows(result));
    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'compact-empty-detail';
      empty.textContent = result.error || 'Không có log chi tiết bổ sung.';
      children.push(empty);
    }
    details.append(...children);
    group.append(details);
    return group;
  }

  function installToolbar(resultList) {
    const toolbar = document.createElement('div');
    toolbar.className = 'compact-results-toolbar';
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'secondary';
    expand.textContent = 'Mở tất cả';
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'secondary';
    collapse.textContent = 'Thu gọn';
    expand.addEventListener('click', () => resultList.querySelectorAll('.model-result-group').forEach((group) => { group.open = true; }));
    collapse.addEventListener('click', () => resultList.querySelectorAll('.model-result-group').forEach((group) => { group.open = false; }));
    toolbar.append(expand, collapse);
    resultList.append(toolbar);
  }

  renderBenchmarkResults = async function renderCompactBenchmarkResults(runResult) {
    const items = [await benchmarkItem('Ảnh gốc', state.inputPath, 'source')];
    if (state.benchmark.referencePath) {
      items.push(await benchmarkItem('Photoshop Reference', state.benchmark.referencePath, 'reference'));
    }

    for (const result of runResult.results.filter((entry) => entry.outputPath && !entry.error)) {
      items.push(await benchmarkItem(result.label, result.outputPath, result.id));
      if (result.protection?.maskPath) items.push(await benchmarkItem('Packaging Hybrid · Combined Mask', result.protection.maskPath, `${result.id}-protection-mask`));
      if (result.protection?.semantic?.maskPath) items.push(await benchmarkItem('Text/Logo Semantic Mask', result.protection.semantic.maskPath, `${result.id}-semantic-mask`));
      if (result.protection?.barcode?.maskPath) items.push(await benchmarkItem('QR/Barcode Guard Mask', result.protection.barcode.maskPath, `${result.id}-barcode-mask`));
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
    installToolbar(resultList);
    resultList.append(...runResult.results.map(createModelGroup));

    $('benchmarkFolderName').textContent = runResult.outputDirectory;
    $('benchmarkFolderName').title = runResult.outputDirectory;
    $('benchmarkSummaryCard').hidden = false;
    await updateBenchmarkComparison();
  };

  installCompactStyles();
  document.title = 'Print Upscale Studio V2.6.3 Compact Results';
  const brandVersion = document.querySelector('.brand span');
  if (brandVersion) brandVersion.textContent = 'Studio V2.6.3 · Compact Results';
})();
