(() => {
  const get = (id) => document.getElementById(id);
  const productionState = {
    inputs: [],
    outputDirectory: null,
    analyses: new Map(),
    queue: null,
    analyzing: false
  };

  function basename(value) {
    return value ? String(value).replaceAll('\\', '/').split('/').pop() : '';
  }

  function bytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let current = size;
    let unit = 0;
    while (current >= 1024 && unit < units.length - 1) {
      current /= 1024;
      unit += 1;
    }
    return `${current.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function duration(milliseconds) {
    const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} giây`;
    return `${Math.floor(seconds / 60)} phút ${Math.round(seconds % 60)} giây`;
  }

  function installStyles() {
    if (get('smartProductionStyles')) return;
    const style = document.createElement('style');
    style.id = 'smartProductionStyles';
    style.textContent = `
      .production-nav.active { border-color: #2e7390; background: #12212a; }
      .production-nav.active b { color: #67d7ff; }
      .production-tag { display: inline-block; margin-left: 5px; padding: 2px 5px; border-radius: 99px; background: #18394a; color: #b8edff; font-style: normal; font-size: 8px; letter-spacing: .08em; vertical-align: 1px; }
      .production-settings { display: grid; gap: 13px; }
      .production-notice { background: #101f27; border: 1px solid #28566b; color: #bfeaff; }
      .production-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .production-actions.three { grid-template-columns: repeat(3, 1fr); }
      .production-target-grid { display: grid; grid-template-columns: 1fr 1fr 88px; gap: 8px; }
      .production-target-grid .setting-group:last-child { grid-column: 1 / -1; }
      .production-file-summary { padding: 10px; border: 1px solid #2c3d47; border-radius: 10px; background: #10171c; font-size: 10px; color: #9eabb4; line-height: 1.45; }
      .production-card { padding: 18px; }
      .production-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
      .production-head h2 { margin: 0; font-size: 20px; }
      .production-head-meta { color: #7c8b95; font-size: 10px; text-align: right; line-height: 1.45; }
      .production-overall { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; margin-bottom: 14px; padding: 11px; border: 1px solid #283b46; border-radius: 11px; background: #0f171c; }
      .production-progress { height: 7px; border-radius: 99px; overflow: hidden; background: #25313a; margin-top: 7px; }
      .production-progress span { display: block; height: 100%; width: 0; background: #67d7ff; transition: width .2s ease; }
      .production-counts { color: #a9dff0; font-size: 10px; white-space: nowrap; }
      .production-list { display: grid; gap: 8px; }
      .production-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 11px; border: 1px solid #29333b; border-radius: 10px; background: #11161b; }
      .production-index { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: #202a31; color: #8e9aa3; font-size: 10px; font-weight: 800; }
      .production-row strong, .production-row small { display: block; }
      .production-row strong { font-size: 12px; color: #e1e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .production-row small { margin-top: 4px; color: #87939c; font-size: 9px; line-height: 1.4; }
      .production-row.failed { border-color: #69383e; background: #241719; }
      .production-row.completed { border-color: #365b40; }
      .production-row.processing, .production-row.analyzing { border-color: #2c657c; background: #10202a; }
      .production-status { min-width: 72px; text-align: right; font-size: 9px; font-weight: 900; letter-spacing: .05em; color: #9aa6ae; }
      .production-status.completed { color: #bff28e; }
      .production-status.failed { color: #ff9ca7; }
      .production-status.processing, .production-status.analyzing { color: #8de5ff; }
      .production-warning { margin-top: 8px; padding: 8px 10px; border: 1px solid #6d5522; border-radius: 8px; background: #292112; color: #ffd989; font-size: 10px; line-height: 1.4; }
      .production-empty { padding: 30px; text-align: center; color: #7e8991; border: 1px dashed #33414a; border-radius: 12px; }
      @media (max-width: 1180px) {
        .production-target-grid { grid-template-columns: 1fr 1fr; }
        .production-target-grid .setting-group:last-child { grid-column: auto; }
      }
    `;
    document.head.append(style);
  }

  function installScaleOptions() {
    const select = get('scaleSelect');
    if (!select) return;
    for (const value of [6, 8]) {
      if ([...select.options].some((option) => Number(option.value) === value)) continue;
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}× · AI 4× + Lanczos`;
      select.append(option);
    }
  }

  function installNav() {
    if (get('smartProductionNav')) return;
    const button = document.createElement('button');
    button.id = 'smartProductionNav';
    button.className = 'nav-item production-nav';
    button.dataset.tool = 'smart-production';
    button.innerHTML = '<b>07</b><span>Smart Production <em class="production-tag">BATCH</em><small>Analyzer · Queue · tối đa 8×</small></span>';
    get('toolNav').append(button);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      enterProduction();
    });
  }

  function installSettings() {
    if (get('smartProductionSettings')) return;
    const panel = document.createElement('section');
    panel.id = 'smartProductionSettings';
    panel.className = 'tool-settings production-settings';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="lab-notice production-notice"><b>Smart Production Workflow</b><span>Phân tích từng ảnh, đề xuất model và chạy batch tuần tự. Giới hạn cứng tối đa 8×.</span></div>
      <div class="production-actions">
        <button id="productionAddFilesBtn" class="secondary" type="button">Thêm ảnh</button>
        <button id="productionClearFilesBtn" class="danger-text" type="button">Xóa danh sách</button>
      </div>
      <div id="productionFileSummary" class="production-file-summary">Chưa chọn ảnh.</div>
      <div class="setting-group">
        <label>Thư mục đầu ra</label>
        <button id="productionOutputBtn" class="secondary wide" type="button"><span id="productionOutputName">Chọn thư mục</span></button>
      </div>
      <div class="setting-group">
        <label for="productionOutputMode">Cách xác định kích thước</label>
        <select id="productionOutputMode"><option value="fixed-scale">Scale cố định</option><option value="target-print">Kích thước in + DPI</option></select>
      </div>
      <div id="productionFixedScaleGroup" class="setting-group">
        <label for="productionScale">Scale đầu ra</label>
        <select id="productionScale"><option value="2">2×</option><option value="3">3×</option><option value="4" selected>4×</option><option value="6">6× · AI 4× + Lanczos</option><option value="8">8× · AI 4× + Lanczos</option></select>
      </div>
      <div id="productionTargetGroup" class="production-target-grid" hidden>
        <div class="setting-group"><label for="productionPrintWidth">Rộng</label><input id="productionPrintWidth" class="text-input" type="number" min="0" step="0.1" placeholder="60" /></div>
        <div class="setting-group"><label for="productionPrintHeight">Cao</label><input id="productionPrintHeight" class="text-input" type="number" min="0" step="0.1" placeholder="80" /></div>
        <div class="setting-group"><label for="productionPrintUnit">Đơn vị</label><select id="productionPrintUnit"><option value="cm">cm</option><option value="mm">mm</option><option value="in">inch</option></select></div>
        <div class="setting-group"><label for="productionPrintDpi">DPI</label><select id="productionPrintDpi"><option value="150">150</option><option value="200">200</option><option value="240">240</option><option value="300" selected>300</option></select><small class="setting-hint">Yêu cầu vượt 8× sẽ bị chặn, không cố xử lý.</small></div>
      </div>
      <div class="color-output-grid">
        <div class="setting-group"><label for="productionFormat">RGB Master</label><select id="productionFormat"><option value="png">PNG lossless</option><option value="tiff">TIFF LZW</option></select></div>
        <div class="setting-group"><label for="productionFallbackModel">Model khi không dùng đề xuất</label><select id="productionFallbackModel"><option value="high-fidelity-4x">High Fidelity</option><option value="remacri-4x">Remacri</option><option value="realesrgan-x4plus">RealESRGAN Detail</option></select></div>
      </div>
      <label class="check-row"><input id="productionAutoModel" type="checkbox" checked /><span>Smart Analyzer tự chọn model cho từng ảnh</span></label>
      <label class="check-row"><input id="productionQualityCheck" type="checkbox" checked /><span>Upscale Quality Check sau từng job</span></label>
      <label class="check-row"><input id="productionCmykEnabled" type="checkbox" /><span>Tạo thêm CMYK TIFF sau RGB</span></label>
      <div id="productionCmykProfileGroup" class="setting-group" hidden><label for="productionCmykProfile">CMYK profile</label><select id="productionCmykProfile"><option value="iso-coated-v2">ISO Coated v2 (ECI)</option><option value="pso-coated-v3">PSO Coated v3 (FOGRA51)</option><option value="pso-uncoated-v3">PSO Uncoated v3 (FOGRA52)</option><option value="custom">Custom ICC đã lưu</option></select></div>
      <div class="production-actions">
        <button id="productionAnalyzeBtn" class="secondary" type="button">Phân tích tất cả</button>
        <button id="productionStartBtn" class="primary" type="button">Chạy Batch</button>
      </div>
      <div class="production-actions three">
        <button id="productionPauseBtn" class="secondary" type="button" disabled>Pause</button>
        <button id="productionResumeBtn" class="secondary" type="button" disabled>Resume</button>
        <button id="productionRetryBtn" class="secondary" type="button" disabled>Retry lỗi</button>
      </div>
    `;
    document.querySelector('.output-row').before(panel);
  }

  function installResults() {
    if (get('smartProductionCard')) return;
    const card = document.createElement('section');
    card.id = 'smartProductionCard';
    card.className = 'benchmark-summary-card production-card';
    card.hidden = true;
    card.innerHTML = `
      <div class="production-head"><div><p class="eyebrow">SMART PRODUCTION</p><h2>Batch Queue</h2></div><div id="productionHeadMeta" class="production-head-meta">Tối đa 8× · chạy tuần tự</div></div>
      <div class="production-overall"><div><strong id="productionOverallTitle">Chưa có job</strong><div class="production-progress"><span id="productionOverallBar"></span></div><small id="productionOverallMessage">Thêm ảnh để bắt đầu.</small></div><div id="productionCounts" class="production-counts">0 ảnh</div></div>
      <div id="productionWarnings"></div>
      <div id="productionList" class="production-list"><div class="production-empty">Chưa có ảnh trong queue.</div></div>
    `;
    const benchmark = get('benchmarkSummaryCard');
    benchmark.insertAdjacentElement('afterend', card);
  }

  function optionsForAnalysis() {
    const mode = get('productionOutputMode').value;
    const options = {
      scale: Number(get('productionScale').value),
      format: get('productionFormat').value,
      cmyk: get('productionCmykEnabled').checked
    };
    if (mode === 'target-print') {
      options.targetPrint = {
        width: Number(get('productionPrintWidth').value) || null,
        height: Number(get('productionPrintHeight').value) || null,
        unit: get('productionPrintUnit').value,
        dpi: Number(get('productionPrintDpi').value)
      };
    }
    return options;
  }

  function settingsForBatch() {
    const mode = get('productionOutputMode').value;
    return {
      outputMode: mode,
      fixedScale: Number(get('productionScale').value),
      targetPrint: {
        width: Number(get('productionPrintWidth').value) || null,
        height: Number(get('productionPrintHeight').value) || null,
        unit: get('productionPrintUnit').value,
        dpi: Number(get('productionPrintDpi').value)
      },
      format: get('productionFormat').value,
      dpi: mode === 'target-print' ? Number(get('productionPrintDpi').value) : 300,
      autoRecommendModel: get('productionAutoModel').checked,
      fallbackModel: get('productionFallbackModel').value,
      qualityCheckEnabled: get('productionQualityCheck').checked,
      cmykEnabled: get('productionCmykEnabled').checked,
      colorOutputSettings: { profileId: get('productionCmykProfile').value },
      maxOutputPixels: 300000000
    };
  }

  function syncModeControls() {
    const target = get('productionOutputMode').value === 'target-print';
    get('productionFixedScaleGroup').hidden = target;
    get('productionTargetGroup').hidden = !target;
    get('productionCmykProfileGroup').hidden = !get('productionCmykEnabled').checked;
  }

  function syncButtons() {
    const status = productionState.queue?.status || 'idle';
    const running = ['running', 'pausing'].includes(status);
    get('productionStartBtn').disabled = running || !productionState.inputs.length || !productionState.outputDirectory;
    get('productionAnalyzeBtn').disabled = running || productionState.analyzing || !productionState.inputs.length;
    get('productionPauseBtn').disabled = status !== 'running';
    get('productionResumeBtn').disabled = status !== 'paused';
    get('productionRetryBtn').disabled = running || !(productionState.queue?.counts?.failed > 0);
    get('productionAddFilesBtn').disabled = running;
    get('productionClearFilesBtn').disabled = running || !productionState.inputs.length;
  }

  function renderFileSummary() {
    const count = productionState.inputs.length;
    const analyses = [...productionState.analyses.values()];
    const totalEstimate = analyses.reduce((sum, item) => sum + (item.output?.totalBytes || 0), 0);
    get('productionFileSummary').textContent = count
      ? `${count} ảnh${analyses.length ? ` · đã phân tích ${analyses.length}/${count} · ước tính ${bytes(totalEstimate)}` : ''}`
      : 'Chưa chọn ảnh.';
    get('productionOutputName').textContent = productionState.outputDirectory ? basename(productionState.outputDirectory) : 'Chọn thư mục';
    get('productionOutputName').title = productionState.outputDirectory || '';
    syncButtons();
  }

  function analysisDetail(analysis) {
    if (!analysis) return 'Chưa phân tích';
    const labels = {
      'packaging-artwork': 'Packaging / artwork',
      'text-line-art': 'Text / line art',
      'detail-rich': 'Ảnh nhiều texture',
      photo: 'Ảnh chụp'
    };
    const scale = analysis.targetPlan?.requiredScale || analysis.selectedScale;
    return `${labels[analysis.classification] || analysis.classification} · ${analysis.recommendation.model} · ${Number(scale).toFixed(Number(scale) % 1 ? 2 : 0)}× · ${analysis.output.megapixels} MP · ${bytes(analysis.output.totalBytes)}`;
  }

  function renderQueue(status = productionState.queue) {
    productionState.queue = status || productionState.queue;
    const queue = productionState.queue;
    const list = get('productionList');
    list.replaceChildren();

    const jobs = queue?.jobs?.length
      ? queue.jobs
      : productionState.inputs.map((inputPath, index) => ({
        id: `pending-${index}`,
        order: index + 1,
        inputPath,
        fileName: basename(inputPath),
        status: productionState.analyses.has(inputPath) ? 'analyzed' : 'queued',
        analysis: productionState.analyses.get(inputPath) || null,
        progress: 0,
        message: productionState.analyses.has(inputPath) ? 'Đã phân tích' : 'Chờ phân tích'
      }));

    if (!jobs.length) {
      list.innerHTML = '<div class="production-empty">Chưa có ảnh trong queue.</div>';
    } else {
      for (const job of jobs) {
        const row = document.createElement('div');
        row.className = `production-row ${job.status || 'queued'}`;
        const index = document.createElement('div');
        index.className = 'production-index';
        index.textContent = String(job.order || 0).padStart(2, '0');
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = job.fileName || basename(job.inputPath);
        title.title = job.inputPath || '';
        const detail = document.createElement('small');
        const parts = [];
        if (job.analysis) parts.push(analysisDetail(job.analysis));
        if (job.message && !['Chờ phân tích', 'Đã phân tích'].includes(job.message)) parts.push(job.message);
        if (job.qualityCheck) parts.push(`Quality ${String(job.qualityCheck.status || '').toUpperCase()}${Number.isFinite(job.qualityCheck.score) ? ` ${job.qualityCheck.score}/100` : ''}`);
        if (job.cmykOutput?.outputPath) parts.push('CMYK ✓');
        if (job.durationMs) parts.push(duration(job.durationMs));
        if (job.error) parts.push(job.error);
        detail.textContent = parts.join(' · ') || job.message || 'Chờ xử lý';
        info.append(title, detail);
        const statusText = document.createElement('div');
        statusText.className = `production-status ${job.status || 'queued'}`;
        const labels = { queued: 'QUEUED', analyzed: 'READY', analyzing: 'ANALYZE', processing: `${job.progress || 0}%`, completed: 'DONE', failed: 'ERROR' };
        statusText.textContent = labels[job.status] || String(job.status || '').toUpperCase();
        row.append(index, info, statusText);
        list.append(row);
      }
    }

    const counts = queue?.counts || { total: productionState.inputs.length, completed: 0, failed: 0, queued: productionState.inputs.length };
    const progress = Number(queue?.progress) || 0;
    get('productionOverallBar').style.width = `${Math.max(0, Math.min(100, progress))}%`;
    get('productionOverallTitle').textContent = queue?.status && queue.status !== 'idle'
      ? `Batch ${queue.status.replaceAll('-', ' ')}`
      : `${counts.total || 0} ảnh trong queue`;
    get('productionOverallMessage').textContent = queue?.message || (counts.total ? 'Sẵn sàng phân tích và xử lý.' : 'Thêm ảnh để bắt đầu.');
    get('productionCounts').textContent = `${counts.completed || 0} xong · ${counts.failed || 0} lỗi · ${counts.queued || 0} chờ`;
    get('productionHeadMeta').textContent = queue?.outputDirectory || 'Tối đa 8× · chạy tuần tự';
    get('productionHeadMeta').title = queue?.outputDirectory || '';

    const warnings = get('productionWarnings');
    warnings.replaceChildren();
    const allWarnings = jobs.flatMap((job) => job.analysis?.warnings || []);
    for (const warning of [...new Set(allWarnings)].slice(0, 3)) {
      const element = document.createElement('div');
      element.className = 'production-warning';
      element.textContent = warning;
      warnings.append(element);
    }
    renderFileSummary();
  }

  async function addFiles() {
    const selected = await window.studio.selectBatchInputs();
    if (!selected?.length) return;
    productionState.inputs = [...new Set([...productionState.inputs, ...selected])];
    renderQueue();
  }

  function clearFiles() {
    productionState.inputs = [];
    productionState.analyses.clear();
    productionState.queue = null;
    renderQueue();
  }

  async function chooseOutputDirectory() {
    const directory = await window.studio.selectProductionOutputDirectory();
    if (!directory) return;
    productionState.outputDirectory = directory;
    renderFileSummary();
  }

  async function analyzeAll() {
    if (!productionState.inputs.length || productionState.analyzing) return;
    productionState.analyzing = true;
    syncButtons();
    const options = optionsForAnalysis();
    try {
      for (let index = 0; index < productionState.inputs.length; index += 1) {
        const inputPath = productionState.inputs[index];
        get('productionOverallTitle').textContent = `Phân tích ${index + 1}/${productionState.inputs.length}`;
        get('productionOverallMessage').textContent = basename(inputPath);
        get('productionOverallBar').style.width = `${Math.round((index / productionState.inputs.length) * 100)}%`;
        try {
          productionState.analyses.set(inputPath, await window.studio.analyzeImage({ inputPath, options }));
        } catch (error) {
          productionState.analyses.set(inputPath, {
            inputPath,
            classification: 'error',
            recommendation: { model: 'high-fidelity-4x' },
            output: { megapixels: 0, totalBytes: 0 },
            warnings: [error.message || String(error)]
          });
        }
        renderQueue();
      }
      get('productionOverallBar').style.width = '100%';
      get('productionOverallTitle').textContent = 'Phân tích hoàn tất';
      get('productionOverallMessage').textContent = `${productionState.analyses.size} ảnh đã được Smart Analyzer đánh giá.`;
    } finally {
      productionState.analyzing = false;
      syncButtons();
    }
  }

  async function startBatch() {
    if (!productionState.inputs.length) return;
    if (!productionState.outputDirectory) {
      await chooseOutputDirectory();
      if (!productionState.outputDirectory) return;
    }
    try {
      productionState.queue = await window.studio.startProduction({
        inputs: productionState.inputs,
        outputDirectory: productionState.outputDirectory,
        settings: settingsForBatch()
      });
      renderQueue();
    } catch (error) {
      get('productionOverallTitle').textContent = 'Không thể bắt đầu batch';
      get('productionOverallMessage').textContent = error.message || String(error);
    }
  }

  function enterProduction() {
    state.tool = 'smart-production';
    document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tool === 'smart-production'));
    get('toolTitle').textContent = 'Smart Production Workflow';
    get('toolDescription').textContent = 'Smart Analyzer, Target Print Size và Batch Queue ổn định đến tối đa 8×.';
    get('privacyBadge').textContent = 'Batch local · tối đa 8×';
    get('privacyBadge').classList.remove('cloud', 'lab');
    get('privacyBadge').classList.add('lab');

    document.querySelectorAll('.tool-settings').forEach((element) => { element.hidden = element.id !== 'smartProductionSettings'; });
    document.querySelectorAll('.common-setting').forEach((element) => { element.hidden = true; });
    document.querySelector('.output-row').hidden = true;
    get('runBtn').hidden = true;
    get('progressWrap').hidden = true;
    get('resultBox').hidden = true;
    document.querySelector('.preview-panel').hidden = true;
    get('inspectorCard').hidden = true;
    get('benchmarkSummaryCard').hidden = true;
    get('smartProductionSettings').hidden = false;
    get('smartProductionCard').hidden = false;
    if (get('colorOutputJobCard')) get('colorOutputJobCard').hidden = true;
    document.title = 'Print Upscale Studio V2.7 Smart Production';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.7 · Smart Production';
    renderQueue();
  }

  function exitProduction() {
    get('smartProductionSettings').hidden = true;
    get('smartProductionCard').hidden = true;
    document.querySelector('.preview-panel').hidden = false;
    document.querySelector('.output-row').hidden = false;
    get('runBtn').hidden = false;
  }

  function bindEvents() {
    get('productionOutputMode').addEventListener('change', syncModeControls);
    get('productionCmykEnabled').addEventListener('change', syncModeControls);
    get('productionAddFilesBtn').addEventListener('click', addFiles);
    get('productionClearFilesBtn').addEventListener('click', clearFiles);
    get('productionOutputBtn').addEventListener('click', chooseOutputDirectory);
    get('productionAnalyzeBtn').addEventListener('click', analyzeAll);
    get('productionStartBtn').addEventListener('click', startBatch);
    get('productionPauseBtn').addEventListener('click', async () => renderQueue(await window.studio.pauseProduction()));
    get('productionResumeBtn').addEventListener('click', async () => renderQueue(await window.studio.resumeProduction()));
    get('productionRetryBtn').addEventListener('click', async () => renderQueue(await window.studio.retryFailedProduction()));
    get('toolNav').addEventListener('click', (event) => {
      const button = event.target.closest('.nav-item');
      if (button && button.dataset.tool !== 'smart-production') exitProduction();
    });
    window.studio.onProductionStatus((status) => renderQueue(status));
  }

  installStyles();
  installScaleOptions();
  installNav();
  installSettings();
  installResults();
  bindEvents();
  syncModeControls();
  renderQueue();
  window.studio.getProductionStatus().then((status) => {
    if (status?.status && status.status !== 'idle') renderQueue(status);
  }).catch(() => {});
})();