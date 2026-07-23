(() => {
  const get = (id) => document.getElementById(id);
  const settings = get('vectorSettings');
  const afterImage = get('afterImage');
  const resultBox = get('resultBox');
  if (!settings || !afterImage || !resultBox || !window.studio) return;

  const HEATMAP_SIZE = 768;
  const GEOMETRY_THRESHOLD = 18;
  const COLOR_THRESHOLD = 28;
  let assets = [];
  let activeAssetId = null;

  function engineName(value) {
    const id = String(value || '').toLowerCase();
    if (id.includes('autotrace')) return 'AutoTrace';
    if (id.includes('vtracer')) return 'VTracer';
    if (id.includes('potrace')) return 'Potrace';
    return value || 'Engine';
  }

  function install() {
    if (get('vectorEngineComparison')) return;
    const style = document.createElement('style');
    style.textContent = `
      .vector-engine-comparison { border: 1px solid #45596c; background: #111a23; border-radius: 10px; padding: 10px; display: grid; gap: 8px; }
      .vector-engine-comparison[hidden] { display: none; }
      .vector-engine-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .vector-engine-head strong { color: #d9e8f5; font-size: 11px; }
      .vector-engine-grid { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
      .vector-engine-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .vector-engine-actions button { min-width: 68px; }
      .vector-engine-meta { color: #93a9bb; font-size: 9px; line-height: 1.45; margin: 0; }
      .vector-engine-meta.reject { color: #ffaaa4; }
      .vector-heatmap-legend { color: #7f96a8; font-size: 8px; line-height: 1.45; margin: -2px 0 0; }
      .vector-heatmap-legend b:first-child { color: #ff6b61; }
      .vector-heatmap-legend b:last-child { color: #ffd45e; }
    `;
    document.head.append(style);

    const panel = document.createElement('section');
    panel.id = 'vectorEngineComparison';
    panel.className = 'vector-engine-comparison';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="vector-engine-head">
        <strong>So sánh candidate engine</strong>
        <span class="smart-vector-badge">NO RETRACE</span>
      </div>
      <div class="vector-engine-grid">
        <select id="vectorEngineCandidate"></select>
        <div class="vector-engine-actions">
          <button id="vectorEnginePreview" class="secondary" type="button">Xem</button>
          <button id="vectorEngineHeatmap" class="secondary" type="button">Heatmap</button>
          <button id="vectorEngineApply" class="secondary" type="button">Chọn</button>
        </div>
      </div>
      <p id="vectorEngineMeta" class="vector-engine-meta"></p>
      <p class="vector-heatmap-legend"><b>Đỏ</b>: lệch hình học/biên · <b>Vàng</b>: lệch màu trong vùng hình trùng nhau.</p>
    `;
    settings.append(panel);
    get('vectorEngineCandidate').addEventListener('change', syncMeta);
    get('vectorEnginePreview').addEventListener('click', previewCandidate);
    get('vectorEngineHeatmap').addEventListener('click', previewHeatmap);
    get('vectorEngineApply').addEventListener('click', applyCandidate);
  }

  function selectedAsset() {
    const id = get('vectorEngineCandidate')?.value;
    return assets.find((asset) => String(asset.id) === String(id)) || null;
  }

  function referenceAsset(asset) {
    return assets.find((item) => item.id === activeAssetId && item.id !== asset?.id)
      || assets.find((item) => item.id !== asset?.id)
      || null;
  }

  function syncMeta() {
    const asset = selectedAsset();
    const meta = get('vectorEngineMeta');
    const apply = get('vectorEngineApply');
    const heatmap = get('vectorEngineHeatmap');
    if (!asset) {
      meta.textContent = '';
      apply.disabled = true;
      heatmap.disabled = true;
      return;
    }
    const metrics = asset.metrics || {};
    const selected = asset.selected || asset.id === activeAssetId ? ' · đang dùng' : '';
    const rejected = asset.rejected ? ` · REJECT${asset.rejectedReason ? `: ${asset.rejectedReason}` : ''}` : '';
    meta.textContent = `${engineName(asset.engine)}${selected} · score ${asset.consensusScore ?? asset.score ?? '—'} · agreement ${asset.agreementScore ?? '—'} · fidelity ${metrics.fidelity ?? '—'} · recall ${metrics.edgeRecall ?? '—'} · curve ${metrics.curveFitScore ?? '—'} · ${metrics.nodeEstimate ?? '—'} node${rejected}`;
    meta.classList.toggle('reject', Boolean(asset.rejected));
    apply.disabled = Boolean(asset.rejected) || asset.id === activeAssetId || state.busy;
    heatmap.disabled = !referenceAsset(asset) || state.busy;
  }

  function render(payload) {
    assets = Array.isArray(payload?.vectorReport?.candidateAssets) ? payload.vectorReport.candidateAssets : [];
    const panel = get('vectorEngineComparison');
    panel.hidden = assets.length < 2;
    if (assets.length < 2) return;

    activeAssetId = assets.find((asset) => asset.selected)?.id || payload?.vectorReport?.selectedCandidate || null;
    const select = get('vectorEngineCandidate');
    select.replaceChildren();
    for (const asset of assets) {
      const option = document.createElement('option');
      option.value = asset.id;
      option.textContent = `${engineName(asset.engine)}${asset.selected ? ' · Auto chọn' : ''}${asset.rejected ? ' · REJECT' : ''}`;
      select.append(option);
    }
    select.value = String(activeAssetId || assets[0].id);
    syncMeta();
  }

  async function assetUrl(asset) {
    return `${await window.studio.fileUrl(asset.path)}?t=${Date.now()}`;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image), { once: true });
      image.addEventListener('error', () => reject(new Error('Không tải được candidate SVG để tạo heatmap.')), { once: true });
      image.src = url;
    });
  }

  function rasterize(image, size = HEATMAP_SIZE) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, size, size);
    const width = Math.max(1, image.naturalWidth || image.width || size);
    const height = Math.max(1, image.naturalHeight || image.height || size);
    const scale = Math.min(size / width, size / height);
    const drawWidth = Math.max(1, Math.round(width * scale));
    const drawHeight = Math.max(1, Math.round(height * scale));
    context.drawImage(image, Math.round((size - drawWidth) / 2), Math.round((size - drawHeight) / 2), drawWidth, drawHeight);
    return context.getImageData(0, 0, size, size);
  }

  function buildHeatmap(reference, candidate, size = HEATMAP_SIZE) {
    const output = new ImageData(size, size);
    let geometryPixels = 0;
    let colorPixels = 0;
    let foregroundPixels = 0;

    for (let offset = 0; offset < output.data.length; offset += 4) {
      const referenceAlpha = reference.data[offset + 3];
      const candidateAlpha = candidate.data[offset + 3];
      const referenceVisible = referenceAlpha > GEOMETRY_THRESHOLD;
      const candidateVisible = candidateAlpha > GEOMETRY_THRESHOLD;
      if (referenceVisible || candidateVisible) foregroundPixels += 1;

      if (referenceVisible !== candidateVisible || Math.abs(referenceAlpha - candidateAlpha) > 72) {
        output.data[offset] = 255;
        output.data[offset + 1] = 52;
        output.data[offset + 2] = 42;
        output.data[offset + 3] = 230;
        geometryPixels += 1;
        continue;
      }

      if (referenceVisible && candidateVisible) {
        const delta = (
          Math.abs(reference.data[offset] - candidate.data[offset])
          + Math.abs(reference.data[offset + 1] - candidate.data[offset + 1])
          + Math.abs(reference.data[offset + 2] - candidate.data[offset + 2])
        ) / 3;
        if (delta > COLOR_THRESHOLD) {
          output.data[offset] = 255;
          output.data[offset + 1] = 196;
          output.data[offset + 2] = 28;
          output.data[offset + 3] = Math.min(235, 120 + Math.round(delta * 0.6));
          colorPixels += 1;
        }
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.putImageData(output, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      geometryRatio: foregroundPixels ? (geometryPixels / foregroundPixels) * 100 : 0,
      colorRatio: foregroundPixels ? (colorPixels / foregroundPixels) * 100 : 0,
      changedPixels: geometryPixels + colorPixels
    };
  }

  async function previewCandidate() {
    const asset = selectedAsset();
    if (!asset?.path) return;
    afterImage.src = await assetUrl(asset);
    get('compareStage').hidden = false;
    get('compareControls').hidden = false;
    resultBox.textContent = `${resultBox.textContent}\nĐang preview raw candidate: ${engineName(asset.engine)} · chưa thay đổi file đầu ra.`;
  }

  async function previewHeatmap() {
    const candidateAsset = selectedAsset();
    const baseAsset = referenceAsset(candidateAsset);
    if (!candidateAsset?.path || !baseAsset?.path || state.busy) return;

    try {
      state.busy = true;
      syncMeta();
      get('progressWrap').hidden = false;
      get('progressBar').style.width = '35%';
      get('progressText').textContent = `Đang so biên ${engineName(baseAsset.engine)} và ${engineName(candidateAsset.engine)}...`;
      const [baseImage, candidateImage] = await Promise.all([
        loadImage(await assetUrl(baseAsset)),
        loadImage(await assetUrl(candidateAsset))
      ]);
      const heatmap = buildHeatmap(rasterize(baseImage), rasterize(candidateImage));
      afterImage.src = heatmap.dataUrl;
      get('compareStage').hidden = false;
      get('compareControls').hidden = false;
      resultBox.classList.remove('error');
      resultBox.textContent = `Heatmap ${engineName(baseAsset.engine)} ↔ ${engineName(candidateAsset.engine)}\nLệch hình học: ${heatmap.geometryRatio.toFixed(2)}% vùng artwork\nLệch màu: ${heatmap.colorRatio.toFixed(2)}% vùng artwork\nHeatmap chỉ là preview, không thay đổi SVG đầu ra.`;
      resultBox.hidden = false;
      get('progressBar').style.width = '100%';
      get('progressText').textContent = 'Heatmap hoàn tất';
    } catch (error) {
      resultBox.classList.add('error');
      resultBox.textContent = `Không tạo được heatmap: ${error.message || error}`;
      resultBox.hidden = false;
    } finally {
      state.busy = false;
      syncMeta();
    }
  }

  async function applyCandidate() {
    const asset = selectedAsset();
    if (!asset?.path || asset.rejected || state.busy) return;

    try {
      state.busy = true;
      syncMeta();
      get('progressWrap').hidden = false;
      get('progressBar').style.width = '5%';
      get('progressText').textContent = `Đang chọn ${engineName(asset.engine)} mà không trace lại...`;

      const response = await window.studio.process({
        operation: 'vector-candidate-select',
        inputPath: asset.path,
        outputPath: state.outputPath,
        options: {
          candidateId: asset.id,
          engine: asset.engine,
          profile: 'auto',
          pathPrecision: 3
        }
      });
      const result = typeof response?.outputPath === 'object' ? response.outputPath : null;
      if (!result?.outputPath) throw new Error('Không nhận được SVG sau khi chọn candidate.');

      activeAssetId = asset.id;
      assets = assets.map((item) => ({ ...item, selected: item.id === activeAssetId }));
      const url = await window.studio.fileUrl(result.outputPath);
      afterImage.src = `${url}?t=${Date.now()}`;
      const cleanup = result.vectorCleanup;
      resultBox.classList.remove('error');
      resultBox.textContent = `Đã chọn ${engineName(asset.engine)} không retrace.\nCandidate: ${asset.path}\nOutput: ${result.outputPath}${cleanup ? `\nCleanup ${result.selectedProfile}: ${cleanup.nodesBefore} → ${cleanup.nodesAfter} node · giảm ${cleanup.nodeReduction}%` : ''}`;
      resultBox.hidden = false;
      syncMeta();
    } catch (error) {
      resultBox.classList.add('error');
      resultBox.textContent = `Không thể chọn candidate: ${error.message || error}`;
      resultBox.hidden = false;
    } finally {
      state.busy = false;
      syncMeta();
    }
  }

  install();
  window.addEventListener('vector:result', (event) => render(event.detail));
  if (state.vectorPayload) render(state.vectorPayload);
})();