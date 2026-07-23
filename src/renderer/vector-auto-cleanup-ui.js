(() => {
  const get = (id) => document.getElementById(id);
  const resultBox = get('resultBox');
  const afterImage = get('afterImage');
  if (!resultBox || !afterImage || !window.studio) return;

  let running = false;
  let lastTraceSignature = null;

  function masterPathFor(outputPath) {
    return String(outputPath || '').replace(/\.svg$/i, '.master.svg');
  }

  function candidateSummary(autoSelection) {
    if (!autoSelection?.candidates?.length) return '';
    return autoSelection.candidates.map((candidate) => {
      const status = candidate.accepted ? `${candidate.score}` : `loại: ${candidate.rejectionReasons.join(', ')}`;
      return `${candidate.profile} ${status}`;
    }).join(' · ');
  }

  function isFreshTraceResult() {
    const text = resultBox.textContent || '';
    return state.tool === 'vector-logo'
      && /Đã lưu SVG:/i.test(text)
      && !/Đã tự động áp dụng cleanup/i.test(text)
      && Boolean(state.outputPath)
      && /\.svg$/i.test(state.outputPath);
  }

  async function waitUntilIdle(attempt = 0) {
    if (!isFreshTraceResult()) return;
    if (state.busy) {
      if (attempt < 40) setTimeout(() => waitUntilIdle(attempt + 1), 75);
      return;
    }

    const signature = `${state.outputPath}|${resultBox.textContent}`;
    if (running || signature === lastTraceSignature) return;
    lastTraceSignature = signature;
    running = true;

    const outputPath = state.outputPath;
    const masterPath = masterPathFor(outputPath);
    const originalText = resultBox.textContent;

    try {
      state.busy = true;
      get('vectorCleanupApply') && (get('vectorCleanupApply').disabled = true);
      get('progressWrap').hidden = false;
      get('progressBar').style.width = '8%';
      get('progressText').textContent = 'Đang tự chọn mức cleanup an toàn...';

      const response = await window.studio.process({
        operation: 'vector-cleanup',
        inputPath: masterPath,
        outputPath,
        options: { profile: 'auto', pathPrecision: 3 }
      });
      const payload = response?.outputPath;
      const result = typeof payload === 'object' ? payload : null;
      const cleanup = result?.vectorCleanup;
      if (!result?.outputPath || !cleanup) throw new Error('Auto Cleanup không trả về kết quả hợp lệ.');

      const selected = result.selectedProfile || cleanup.profile;
      const svgUrl = await window.studio.fileUrl(result.outputPath);
      afterImage.src = `${svgUrl}?t=${Date.now()}`;

      const profileSelect = get('vectorCleanupProfile');
      if (profileSelect) profileSelect.value = 'auto';
      const status = get('vectorCleanupRerunStatus');
      if (status) {
        status.classList.remove('error');
        status.textContent = `Auto chọn ${selected}: ${cleanup.nodesBefore} → ${cleanup.nodesAfter} node · giảm ${cleanup.nodeReduction}%.`;
      }

      const comparison = candidateSummary(cleanup.autoSelection);
      resultBox.classList.remove('error');
      resultBox.classList.add('vector-result-lines');
      resultBox.textContent = `${originalText}\nĐã tự động áp dụng cleanup: ${selected} · ${cleanup.nodesBefore} → ${cleanup.nodesAfter} node · giảm ${cleanup.nodeReduction}%${comparison ? `\nAuto Profile: ${comparison}` : ''}`;
      resultBox.hidden = false;
    } catch (error) {
      const status = get('vectorCleanupRerunStatus');
      if (status) {
        status.classList.add('error');
        status.textContent = `Auto Cleanup chưa áp dụng: ${error.message || error}`;
      }
      resultBox.textContent = `${originalText}\nAuto Cleanup chưa áp dụng: ${error.message || error}`;
    } finally {
      state.busy = false;
      running = false;
      if (get('vectorCleanupApply')) get('vectorCleanupApply').disabled = false;
    }
  }

  new MutationObserver(() => queueMicrotask(() => waitUntilIdle())).observe(resultBox, {
    childList: true,
    characterData: true,
    subtree: true
  });
})();
