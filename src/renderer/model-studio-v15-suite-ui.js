(() => {
  const $ = (id) => document.getElementById(id);
  const MODEL_PRESETS = {
    'high-fidelity-4x': 'current-photo',
    'remacri-4x': 'current-packaging',
    'realesrgan-x4plus': 'official-detail'
  };
  let manualMode = false;
  let dragStart = null;
  let manualCrop = null;
  let lastPreview = null;

  function installStyles() {
    if ($('modelStudioV15SuiteStyles')) return;
    const style = document.createElement('style');
    style.id = 'modelStudioV15SuiteStyles';
    style.textContent = `
      .v15-suite-card{border:1px solid #3e5269;border-radius:15px;background:#111923;padding:16px;margin:14px 0;display:grid;gap:12px}
      .v15-suite-card[hidden]{display:none}
      .v15-suite-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.v15-suite-head h3{margin:2px 0 0;font-size:16px}.v15-suite-head small{color:#8492a3}.v15-suite-head>span{white-space:nowrap;color:#a8ff34;font-size:10px;font-weight:800}
      .v15-suite-toolbar{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(220px,.55fr);gap:10px;align-items:stretch}
      .v15-suite-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.v15-suite-actions button{font-size:10px;padding:10px 13px}.v15-suite-actions .secondary{opacity:.86}
      .v15-crop-state{font-size:10px;color:#a0adbc;line-height:1.5;padding:10px 12px;border-radius:9px;background:#0d141d}
      .v15-region-meta{display:flex;gap:7px;flex-wrap:wrap;align-content:flex-start}.v15-region-chip{background:#0d131a;border-radius:8px;padding:7px 9px;font-size:8px;color:#9eabb9}
      .v15-comparison{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.v15-compare-card{border:1px solid #2e3a47;border-radius:11px;padding:8px;background:#151c24;display:grid;gap:7px;min-width:0}.v15-compare-card.best{border-color:#73b7ff;box-shadow:0 0 0 1px rgba(115,183,255,.12)}.v15-compare-card img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#090e14;border-radius:8px}.v15-compare-card strong{font-size:10px}.v15-compare-card small{font-size:8px;color:#8996a6;line-height:1.35}.v15-score{font-size:15px;font-weight:900;color:#73b7ff;float:right}
      .v15-full-action{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.42fr);gap:10px;align-items:stretch}.v15-full-action button{width:100%;min-height:44px}.v15-warning{color:#ffca7a;font-size:9px;line-height:1.4}
      .v15-crop-overlay{position:absolute;border:2px solid #73b7ff;background:rgba(115,183,255,.12);pointer-events:none;z-index:8}.v15-crop-overlay.smart{border-color:#a9ff2c;background:rgba(169,255,44,.11)}.v15-manual-active{cursor:crosshair!important}
      @media(max-width:1220px){.v15-comparison{grid-template-columns:repeat(2,minmax(0,1fr))}.v15-suite-toolbar,.v15-full-action{grid-template-columns:1fr}}
      @media(max-width:760px){.v15-comparison,.v15-suite-actions{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function installCard() {
    const previewColumn = document.querySelector('.preview-column');
    const inspector = $('inspectorCard');
    if (!previewColumn || $('modelStudioV15SuiteCard')) return;
    const card = document.createElement('section');
    card.id = 'modelStudioV15SuiteCard';
    card.className = 'v15-suite-card';
    card.innerHTML = `
      <div class="v15-suite-head"><div><small>MODEL STUDIO V17 · SMART TEST REGION</small><h3>Test một vùng đại diện trước khi chạy toàn ảnh</h3></div><span id="v15PreviewBadge">Sẵn sàng</span></div>
      <div class="v15-suite-toolbar">
        <div class="v15-suite-actions"><button id="v15AutoPreviewBtn" class="primary" type="button">Phân tích và test vùng đại diện</button><button id="v15ManualCropBtn" class="secondary" type="button">Chọn vùng khác</button></div>
        <div id="v15RegionMeta" class="v15-region-meta"></div>
      </div>
      <div id="v15CropState" class="v15-crop-state">AI sẽ quét artwork, chọn một vùng khó và chạy ba model trên đúng vùng đó.</div>
      <div id="v15PreviewResults" class="v15-comparison"></div>
      <div id="v15FullAction" class="v15-full-action" hidden><div id="v15BestReason" class="v15-crop-state"></div><button id="v15UseBestBtn" class="primary" type="button">Áp dụng model tốt nhất cho toàn ảnh</button></div>
    `;
    (inspector || previewColumn.firstElementChild)?.insertAdjacentElement('afterend', card);
    $('v15AutoPreviewBtn').addEventListener('click', () => runPreview(null));
    $('v15ManualCropBtn').addEventListener('click', toggleManualCrop);
    $('v15UseBestBtn').addEventListener('click', applyBestToFullImage);
  }

  function previewModels() {
    const checked = [...document.querySelectorAll('.benchmark-preset:checked:not(:disabled)')];
    const models = [];
    for (const input of checked) {
      for (const model of String(input.dataset.models || '').split(',').filter(Boolean)) {
        if (!models.includes(model)) models.push(model);
      }
    }
    return models.slice(0, 3);
  }

  function setBusy(busy, message) {
    $('v15AutoPreviewBtn').disabled = busy;
    $('v15ManualCropBtn').disabled = busy;
    $('v15PreviewBadge').textContent = message || (busy ? 'Đang chạy' : 'Sẵn sàng');
  }

  async function runPreview(crops) {
    if (!state?.inputPath) {
      $('v15CropState').textContent = 'Chọn ảnh trước khi chạy Smart Test Region.';
      return;
    }
    setBusy(true, 'Đang phân tích');
    $('v15PreviewResults').replaceChildren();
    $('v15RegionMeta').replaceChildren();
    $('v15FullAction').hidden = true;
    $('v15CropState').textContent = crops?.length ? 'Đang test vùng do bạn chọn trên ba model...' : 'AI đang quét artwork để tìm vùng có giá trị đánh giá cao nhất...';
    try {
      const result = await window.studio.runModelStudioPreview({
        inputPath: state.inputPath,
        crops,
        models: previewModels(),
        scale: Math.min(4, Number($('scaleSelect')?.value || 2))
      });
      lastPreview = result;
      await renderPreview(result);
    } catch (error) {
      $('v15CropState').textContent = error.message || String(error);
      $('v15PreviewBadge').textContent = 'Lỗi';
    } finally {
      setBusy(false, lastPreview ? 'Đã test xong' : 'Sẵn sàng');
    }
  }

  async function imageUrl(filePath) {
    if (!filePath) return '';
    try { return await window.studio.fileUrl(filePath); } catch { return ''; }
  }

  function showRegionOverlay(crop, smart = true) {
    const image = $('previewImage'); const stage = $('sourceStage');
    if (!image || !stage || !crop) return;
    $('v15ManualCropOverlay')?.remove();
    const rect = image.getBoundingClientRect();
    const naturalW = image.naturalWidth || 1; const naturalH = image.naturalHeight || 1;
    const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
    const drawW = naturalW * scale; const drawH = naturalH * scale;
    const offsetX = rect.left + (rect.width - drawW) / 2 - stage.getBoundingClientRect().left;
    const offsetY = rect.top + (rect.height - drawH) / 2 - stage.getBoundingClientRect().top;
    const overlay = document.createElement('div');
    overlay.id = 'v15ManualCropOverlay';
    overlay.className = `v15-crop-overlay${smart ? ' smart' : ''}`;
    overlay.style.left = `${offsetX + crop.x * scale}px`;
    overlay.style.top = `${offsetY + crop.y * scale}px`;
    overlay.style.width = `${crop.width * scale}px`;
    overlay.style.height = `${crop.height * scale}px`;
    stage.append(overlay);
  }

  async function renderPreview(result) {
    const region = result.smartRegion || result.crops?.[0];
    $('v15CropState').textContent = `AI đã chọn: ${region?.reason || 'vùng đại diện có mật độ chi tiết cao'}. Chỉ xử lý 1 crop × ${result.results.length} model.`;
    showRegionOverlay(region, region?.id === 'smart-region-1');
    const meta = $('v15RegionMeta');
    meta.replaceChildren();
    [`${region.width}×${region.height}px`, `x:${region.x} · y:${region.y}`, '1 vùng duy nhất'].forEach((text) => {
      const chip = document.createElement('div'); chip.className = 'v15-region-chip'; chip.textContent = text; meta.append(chip);
    });
    const root = $('v15PreviewResults'); root.replaceChildren();
    const sourcePath = result.results.find((item) => item.sourcePath)?.sourcePath;
    const original = document.createElement('article');
    original.className = 'v15-compare-card';
    original.innerHTML = `<strong>Original crop</strong><img alt="Original crop"><small>Vùng nguồn dùng để so sánh công bằng</small>`;
    original.querySelector('img').src = await imageUrl(sourcePath);
    root.append(original);
    for (let index = 0; index < result.ranking.length; index += 1) {
      const rank = result.ranking[index];
      const output = result.results.find((item) => item.model === rank.model);
      const card = document.createElement('article');
      card.className = `v15-compare-card${index === 0 ? ' best' : ''}`;
      card.innerHTML = `<div><strong>${index === 0 ? '✓ ' : ''}${rank.label}</strong><span class="v15-score">${rank.score}</span></div><img alt="${rank.label}"><small>${rank.risk ? 'Cảnh báo halo hoặc edge drift' : 'Quality gate ổn'} · ${Math.round((output?.durationMs || 0) / 100) / 10}s</small>`;
      card.querySelector('img').src = await imageUrl(output?.outputPath);
      root.append(card);
    }
    $('v15BestReason').innerHTML = result.hybridRecommended
      ? '<b>Đề xuất Hybrid:</b> Hai model dẫn đầu gần như ngang nhau trên vùng đại diện. App sẽ dùng protection mask và fallback fidelity.'
      : `<b>Đề xuất:</b> ${result.ranking[0]?.label || 'High Fidelity'} cho kết quả tốt nhất trên vùng khó mà AI đã chọn.`;
    $('v15UseBestBtn').textContent = result.hybridRecommended ? 'Áp dụng Hybrid cho toàn ảnh' : `Áp dụng ${result.ranking[0]?.label || 'model tốt nhất'} cho toàn ảnh`;
    $('v15FullAction').hidden = false;
  }

  function applyBestToFullImage() {
    if (!lastPreview) return;
    const preset = lastPreview.fullImagePreset || MODEL_PRESETS[lastPreview.bestModel] || 'current-photo';
    document.querySelectorAll('.benchmark-preset').forEach((input) => { input.checked = input.value === preset; });
    if ($('miStatus')) $('miStatus').textContent = `Đã chọn ${lastPreview.hybridRecommended ? 'Packaging Hybrid' : lastPreview.ranking[0]?.label}. Bấm Chạy Model Lab để xử lý toàn ảnh.`;
    $('v15CropState').textContent = 'Đã áp dụng lựa chọn. Bước tiếp theo: bấm Chạy Model Lab ở cột bên phải để xử lý toàn bộ artwork.';
    $('runBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleManualCrop() {
    manualMode = !manualMode;
    const stage = $('sourceStage');
    stage?.classList.toggle('v15-manual-active', manualMode);
    $('v15ManualCropBtn').textContent = manualMode ? 'Hủy chọn vùng' : 'Chọn vùng khác';
    $('v15CropState').textContent = manualMode ? 'Kéo trực tiếp trên ảnh để chọn một vùng khác. Tối thiểu 64 × 64 px.' : 'Đã hủy chọn vùng thủ công.';
    if (!manualMode) removeOverlay();
  }

  function removeOverlay() { $('v15ManualCropOverlay')?.remove(); dragStart = null; }

  function imageCoordinate(event) {
    const image = $('previewImage');
    const rect = image.getBoundingClientRect();
    const naturalW = image.naturalWidth || 1; const naturalH = image.naturalHeight || 1;
    const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
    const drawW = naturalW * scale; const drawH = naturalH * scale;
    const offsetX = rect.left + (rect.width - drawW) / 2; const offsetY = rect.top + (rect.height - drawH) / 2;
    return { x: Math.max(0, Math.min(naturalW, (event.clientX - offsetX) / scale)), y: Math.max(0, Math.min(naturalH, (event.clientY - offsetY) / scale)), offsetX, offsetY, scale };
  }

  function installManualCropEvents() {
    const stage = $('sourceStage');
    if (!stage || stage.dataset.v15CropInstalled) return;
    stage.dataset.v15CropInstalled = '1';
    stage.addEventListener('pointerdown', (event) => {
      if (!manualMode || state.tool !== 'model-lab') return;
      event.preventDefault();
      const point = imageCoordinate(event); removeOverlay(); dragStart = point;
      const overlay = document.createElement('div'); overlay.id = 'v15ManualCropOverlay'; overlay.className = 'v15-crop-overlay'; stage.append(overlay); stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', (event) => {
      if (!manualMode || !dragStart) return;
      const point = imageCoordinate(event); const overlay = $('v15ManualCropOverlay'); if (!overlay) return;
      const x1 = Math.min(dragStart.x, point.x); const y1 = Math.min(dragStart.y, point.y); const x2 = Math.max(dragStart.x, point.x); const y2 = Math.max(dragStart.y, point.y);
      overlay.style.left = `${dragStart.offsetX - stage.getBoundingClientRect().left + x1 * dragStart.scale}px`;
      overlay.style.top = `${dragStart.offsetY - stage.getBoundingClientRect().top + y1 * dragStart.scale}px`;
      overlay.style.width = `${(x2 - x1) * dragStart.scale}px`; overlay.style.height = `${(y2 - y1) * dragStart.scale}px`;
      manualCrop = { id: 'manual-1', label: 'Vùng do người dùng chọn', x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
    });
    stage.addEventListener('pointerup', async () => {
      if (!manualMode || !manualCrop) return;
      manualMode = false; stage.classList.remove('v15-manual-active'); $('v15ManualCropBtn').textContent = 'Chọn vùng khác';
      const crop = manualCrop; dragStart = null;
      if (crop.width < 64 || crop.height < 64) { $('v15CropState').textContent = 'Vùng quá nhỏ. Hãy chọn tối thiểu 64 × 64 px.'; removeOverlay(); return; }
      await runPreview([crop]);
    });
  }

  function syncVisibility() { const card = $('modelStudioV15SuiteCard'); if (card) card.hidden = state?.tool !== 'model-lab'; }

  installStyles(); installCard(); installManualCropEvents();
  const originalSelectTool = window.selectTool;
  if (typeof originalSelectTool === 'function' && !window.__modelStudioV15SuiteHook) {
    window.__modelStudioV15SuiteHook = true;
    window.selectTool = function selectToolWithV15Suite(tool) { originalSelectTool(tool); syncVisibility(); };
  }
  syncVisibility();
})();