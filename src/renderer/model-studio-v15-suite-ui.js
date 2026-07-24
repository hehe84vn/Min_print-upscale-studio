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
      .v15-suite-card{border:1px solid #3e5269;border-radius:13px;background:#111923;padding:12px;margin:12px 0;display:grid;gap:10px}
      .v15-suite-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.v15-suite-head h3{margin:0;font-size:13px}.v15-suite-head small{color:#8492a3}
      .v15-suite-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.v15-suite-actions button{font-size:9px;padding:8px}
      .v15-crop-state{font-size:9px;color:#96a3b3;line-height:1.45;padding:8px;border-radius:8px;background:#0d141d}
      .v15-preview-results{display:grid;gap:7px}.v15-preview-row{border:1px solid #2e3a47;border-radius:9px;padding:8px;background:#151c24;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
      .v15-preview-row.best{border-color:#73b7ff}.v15-preview-row strong{font-size:10px}.v15-preview-row small{display:block;margin-top:3px;color:#8996a6;font-size:8px}.v15-score{font-size:15px;font-weight:900;color:#73b7ff}
      .v15-full-action{display:grid;gap:6px}.v15-full-action button{width:100%}.v15-warning{color:#ffca7a;font-size:9px;line-height:1.4}
      .v15-crop-overlay{position:absolute;border:2px solid #73b7ff;background:rgba(115,183,255,.12);pointer-events:none;z-index:8}.v15-manual-active{cursor:crosshair!important}
      .v15-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.v15-thumb{background:#0d131a;border-radius:7px;padding:5px;font-size:7px;color:#8d9aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.append(style);
  }

  function installCard() {
    const settings = $('benchmarkSettings');
    if (!settings || $('modelStudioV15SuiteCard')) return;
    const intelligence = $('modelIntelligenceCard');
    const card = document.createElement('section');
    card.id = 'modelStudioV15SuiteCard';
    card.className = 'v15-suite-card';
    card.innerHTML = `
      <div class="v15-suite-head"><div><small>MODEL STUDIO V15 · PREVIEW CROP</small><h3>Test nhanh trước khi chạy toàn ảnh</h3></div><span id="v15PreviewBadge">Sẵn sàng</span></div>
      <div class="v15-suite-actions"><button id="v15AutoPreviewBtn" class="primary" type="button">Auto Preview Crop</button><button id="v15ManualCropBtn" class="secondary" type="button">Chọn crop thủ công</button></div>
      <div id="v15CropState" class="v15-crop-state">App sẽ tự chọn ba vùng đại diện và chạy các model trên crop nhỏ.</div>
      <div id="v15CropThumbs" class="v15-thumbs"></div>
      <div id="v15PreviewResults" class="v15-preview-results"></div>
      <div id="v15FullAction" class="v15-full-action" hidden><div id="v15BestReason" class="v15-crop-state"></div><button id="v15UseBestBtn" class="primary" type="button">Dùng kết quả tốt nhất cho toàn ảnh</button></div>
    `;
    (intelligence || settings.firstElementChild)?.insertAdjacentElement('afterend', card);
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
      $('v15CropState').textContent = 'Chọn ảnh trước khi chạy Preview Crop.';
      return;
    }
    setBusy(true, 'Đang xử lý');
    $('v15PreviewResults').replaceChildren();
    $('v15FullAction').hidden = true;
    $('v15CropState').textContent = crops?.length ? 'Đang chạy cùng một vùng crop thủ công trên các model...' : 'Đang tự tìm vùng chữ/logo, texture và chi tiết...';
    try {
      const result = await window.studio.runModelStudioPreview({
        inputPath: state.inputPath,
        crops,
        models: previewModels(),
        scale: Math.min(4, Number($('scaleSelect')?.value || 2))
      });
      lastPreview = result;
      renderPreview(result);
    } catch (error) {
      $('v15CropState').textContent = error.message || String(error);
      $('v15PreviewBadge').textContent = 'Lỗi';
    } finally {
      setBusy(false, lastPreview ? 'Đã chấm điểm' : 'Sẵn sàng');
    }
  }

  function renderPreview(result) {
    $('v15CropState').textContent = `${result.crops.length} vùng crop · ${result.results.filter((item) => !item.error).length} kết quả hợp lệ. Điểm dựa trên sharpness, edge drift, halo, clipping và color shift.`;
    const thumbs = $('v15CropThumbs');
    thumbs.replaceChildren();
    for (const crop of result.crops) {
      const item = document.createElement('div');
      item.className = 'v15-thumb';
      item.textContent = `${crop.label}: ${crop.width}×${crop.height}`;
      thumbs.append(item);
    }
    const root = $('v15PreviewResults');
    root.replaceChildren();
    result.ranking.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `v15-preview-row${index === 0 ? ' best' : ''}`;
      row.innerHTML = `<div><strong>${index === 0 ? '✓ ' : ''}${item.label}</strong><small>${item.samples} crop${item.risk ? ' · cảnh báo halo/edge drift' : ' · quality gate ổn'}</small></div><div class="v15-score">${item.score}</div>`;
      root.append(row);
    });
    $('v15BestReason').innerHTML = result.hybridRecommended
      ? '<b>Đề xuất Hybrid:</b> Hai model dẫn đầu có điểm gần nhau. App sẽ dùng Packaging Hybrid với protection mask và fallback fidelity.'
      : `<b>Đề xuất:</b> ${result.ranking[0]?.label || 'High Fidelity'} đạt điểm trung bình cao nhất trên các crop thực tế.`;
    $('v15UseBestBtn').textContent = result.hybridRecommended ? 'Dùng Hybrid tốt nhất cho toàn ảnh' : 'Dùng model tốt nhất cho toàn ảnh';
    $('v15FullAction').hidden = false;
  }

  function applyBestToFullImage() {
    if (!lastPreview) return;
    const preset = lastPreview.fullImagePreset || MODEL_PRESETS[lastPreview.bestModel] || 'current-photo';
    document.querySelectorAll('.benchmark-preset').forEach((input) => { input.checked = input.value === preset; });
    if ($('miStatus')) $('miStatus').textContent = `Đã chọn ${lastPreview.hybridRecommended ? 'Packaging Hybrid' : lastPreview.ranking[0]?.label}. Bấm Chạy Model Lab để xử lý toàn ảnh.`;
    $('v15CropState').textContent = 'Đã áp dụng lựa chọn tốt nhất. Pipeline toàn ảnh vẫn giữ Quality Check và protection mask.';
    $('runBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleManualCrop() {
    manualMode = !manualMode;
    const stage = $('sourceStage');
    stage?.classList.toggle('v15-manual-active', manualMode);
    $('v15ManualCropBtn').textContent = manualMode ? 'Hủy crop thủ công' : 'Chọn crop thủ công';
    $('v15CropState').textContent = manualMode ? 'Kéo chuột trực tiếp trên ảnh để chọn vùng crop. Tối thiểu 64 × 64 px.' : 'Đã hủy chế độ crop thủ công.';
    if (!manualMode) removeOverlay();
  }

  function removeOverlay() {
    $('v15ManualCropOverlay')?.remove();
    dragStart = null;
  }

  function imageCoordinate(event) {
    const image = $('previewImage');
    const rect = image.getBoundingClientRect();
    const naturalW = image.naturalWidth || 1; const naturalH = image.naturalHeight || 1;
    const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
    const drawW = naturalW * scale; const drawH = naturalH * scale;
    const offsetX = rect.left + (rect.width - drawW) / 2; const offsetY = rect.top + (rect.height - drawH) / 2;
    return {
      x: Math.max(0, Math.min(naturalW, (event.clientX - offsetX) / scale)),
      y: Math.max(0, Math.min(naturalH, (event.clientY - offsetY) / scale)),
      offsetX, offsetY, scale
    };
  }

  function installManualCropEvents() {
    const stage = $('sourceStage');
    if (!stage || stage.dataset.v15CropInstalled) return;
    stage.dataset.v15CropInstalled = '1';
    stage.addEventListener('pointerdown', (event) => {
      if (!manualMode || state.tool !== 'model-lab') return;
      event.preventDefault();
      const point = imageCoordinate(event);
      dragStart = point;
      removeOverlay();
      dragStart = point;
      const overlay = document.createElement('div');
      overlay.id = 'v15ManualCropOverlay'; overlay.className = 'v15-crop-overlay';
      stage.append(overlay);
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', (event) => {
      if (!manualMode || !dragStart) return;
      const point = imageCoordinate(event); const overlay = $('v15ManualCropOverlay'); if (!overlay) return;
      const x1 = Math.min(dragStart.x, point.x); const y1 = Math.min(dragStart.y, point.y);
      const x2 = Math.max(dragStart.x, point.x); const y2 = Math.max(dragStart.y, point.y);
      overlay.style.left = `${dragStart.offsetX - stage.getBoundingClientRect().left + x1 * dragStart.scale}px`;
      overlay.style.top = `${dragStart.offsetY - stage.getBoundingClientRect().top + y1 * dragStart.scale}px`;
      overlay.style.width = `${(x2 - x1) * dragStart.scale}px`; overlay.style.height = `${(y2 - y1) * dragStart.scale}px`;
      manualCrop = { id: 'manual-1', label: 'Vùng thủ công', x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
    });
    stage.addEventListener('pointerup', async () => {
      if (!manualMode || !manualCrop) return;
      manualMode = false;
      stage.classList.remove('v15-manual-active');
      $('v15ManualCropBtn').textContent = 'Chọn crop thủ công';
      const crop = manualCrop; dragStart = null;
      if (crop.width < 64 || crop.height < 64) { $('v15CropState').textContent = 'Vùng crop quá nhỏ. Hãy chọn tối thiểu 64 × 64 px.'; removeOverlay(); return; }
      await runPreview([crop]);
    });
  }

  function syncVisibility() {
    const card = $('modelStudioV15SuiteCard');
    if (card) card.hidden = state?.tool !== 'model-lab';
  }

  installStyles();
  installCard();
  installManualCropEvents();
  const originalSelectTool = window.selectTool;
  if (typeof originalSelectTool === 'function' && !window.__modelStudioV15SuiteHook) {
    window.__modelStudioV15SuiteHook = true;
    window.selectTool = function selectToolWithV15Suite(tool) { originalSelectTool(tool); syncVisibility(); };
  }
  syncVisibility();
})();
