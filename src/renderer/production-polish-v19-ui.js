(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const HISTORY_KEY = 'print-upscale-studio:v19-history';
  const MAX_HISTORY = 40;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let panning = false;
  let panStart = null;

  const PRESETS = {
    packaging: { label: 'Packaging', scale: '4', dpi: '300', format: 'png', models: ['packaging-hybrid'], protection: true, cmyk: false },
    photo: { label: 'Photo', scale: '4', dpi: '300', format: 'png', models: ['current-photo'], protection: false, cmyk: false },
    document: { label: 'Document', scale: '4', dpi: '300', format: 'png', models: ['current-packaging'], protection: true, cmyk: false },
    logo: { label: 'Logo', scale: '4', dpi: '300', format: 'png', models: ['current-packaging'], protection: true, cmyk: false },
    custom: { label: 'Custom' }
  };

  function installStyles() {
    if ($('productionPolishV19Styles')) return;
    const style = document.createElement('style');
    style.id = 'productionPolishV19Styles';
    style.textContent = `
      body.v19-model-lab .settings-panel{display:flex;flex-direction:column;max-height:calc(100vh - 118px);overflow:auto}
      body.v19-model-lab #runBtn{position:sticky;bottom:0;z-index:10;box-shadow:0 -10px 22px rgba(9,12,16,.92)}
      .v19-preset-card,.v19-history-card,.v19-queue-card{border:1px solid #334354;border-radius:12px;background:#111923;padding:11px;display:grid;gap:9px;margin-bottom:10px}
      .v19-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.v19-card-head strong{font-size:11px}.v19-card-head small{font-size:8px;color:#8492a3}
      .v19-preset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.v19-preset{border:1px solid #344252;border-radius:8px;background:#151c24;color:#bfc8d2;padding:8px;font-size:9px;cursor:pointer;text-align:left}.v19-preset.active{border-color:var(--accent);color:var(--accent);background:rgba(115,183,255,.08)}
      .v19-advanced{border:1px solid #2c3947;border-radius:9px;background:#0d141d;padding:8px}.v19-advanced summary{cursor:pointer;font-size:9px;font-weight:800;color:#aab5c1}.v19-advanced-body{display:grid;gap:9px;padding-top:10px}
      .v19-preview-toolbar{display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:7px 0}.v19-preview-toolbar button{font-size:8px;padding:6px 8px}
      #sourceStage.v19-zoomable,#compareStage.v19-zoomable{overflow:hidden;touch-action:none}.v19-zoomable img{transform-origin:center center;will-change:transform}.v19-panning{cursor:grabbing!important}
      .v19-bottom-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:10px;margin-top:10px}.v19-queue-list,.v19-history-list{display:grid;gap:6px;max-height:230px;overflow:auto}
      .v19-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px;border-radius:8px;background:#0d141d}.v19-row strong{display:block;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v19-row small{font-size:8px;color:#8592a0}.v19-row-actions{display:flex;gap:5px}.v19-row-actions button{font-size:8px;padding:5px 7px}
      .v19-empty{font-size:9px;color:#8492a3;padding:8px;text-align:center}.v19-badge{font-size:8px;border-radius:999px;padding:3px 7px;background:#202a35;color:#aab5c1}.v19-badge.done{color:#9fd5aa}.v19-badge.running{color:#73b7ff}.v19-badge.failed{color:#ff9fa8}
      @media(max-width:1100px){.v19-bottom-grid{grid-template-columns:1fr}.v19-preset-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function applyPreset(id) {
    const preset = PRESETS[id] || PRESETS.custom;
    document.querySelectorAll('.v19-preset').forEach((button) => button.classList.toggle('active', button.dataset.preset === id));
    if (id === 'custom') return;
    if ($('scaleSelect')) $('scaleSelect').value = preset.scale;
    if ($('dpiSelect')) $('dpiSelect').value = preset.dpi;
    if ($('formatSelect')) $('formatSelect').value = preset.format;
    document.querySelectorAll('.benchmark-preset').forEach((input) => { input.checked = preset.models.includes(input.value); });
    if ($('protectionEnabled')) $('protectionEnabled').checked = preset.protection;
    const cmyk = $('cmykOutputEnabled'); if (cmyk) cmyk.checked = preset.cmyk;
    localStorage.setItem('print-upscale-studio:v19-preset', id);
  }

  function installPresetAndAdvanced() {
    const settings = $('benchmarkSettings');
    if (!settings || $('v19PresetCard')) return;
    const card = document.createElement('section');
    card.id = 'v19PresetCard'; card.className = 'v19-preset-card';
    card.innerHTML = `<div class="v19-card-head"><div><strong>Preset công việc</strong><small>Chọn nhanh, không cần hiểu model kỹ thuật</small></div><span class="v19-badge">V19</span></div><div class="v19-preset-grid">${Object.entries(PRESETS).map(([id,p]) => `<button class="v19-preset" data-preset="${id}" type="button">${p.label}</button>`).join('')}</div>`;
    settings.prepend(card);
    card.querySelectorAll('.v19-preset').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));

    const keepVisible = new Set(['v19PresetCard']);
    const advanced = document.createElement('details'); advanced.className = 'v19-advanced';
    advanced.innerHTML = '<summary>Thiết lập nâng cao</summary><div class="v19-advanced-body"></div>';
    const body = advanced.lastElementChild;
    [...settings.children].forEach((child) => { if (!keepVisible.has(child.id) && child !== advanced) body.append(child); });
    settings.append(advanced);
    applyPreset(localStorage.getItem('print-upscale-studio:v19-preset') || 'packaging');
  }

  function transformPreview() {
    const target = !$('compareStage')?.hidden ? $('compareStage') : $('sourceStage');
    if (!target) return;
    target.querySelectorAll('img').forEach((image) => { image.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`; });
  }
  function resetPreview(fit = true) { zoom = fit ? 1 : 1; panX = 0; panY = 0; transformPreview(); }
  function installPreviewTools() {
    const panel = document.querySelector('.preview-panel'); if (!panel || $('v19PreviewToolbar')) return;
    const toolbar = document.createElement('div'); toolbar.id = 'v19PreviewToolbar'; toolbar.className = 'v19-preview-toolbar';
    toolbar.innerHTML = '<button class="secondary" data-action="minus">−</button><span class="v19-badge" id="v19ZoomLabel">100%</span><button class="secondary" data-action="plus">＋</button><button class="secondary" data-action="fit">Fit</button><button class="secondary" data-action="actual">100%</button>';
    panel.insertBefore(toolbar, panel.firstChild);
    const update = () => { $('v19ZoomLabel').textContent = `${Math.round(zoom * 100)}%`; transformPreview(); };
    toolbar.addEventListener('click', (event) => { const action = event.target.dataset.action; if (!action) return; if (action === 'plus') zoom = Math.min(8, zoom * 1.25); if (action === 'minus') zoom = Math.max(.25, zoom / 1.25); if (action === 'fit' || action === 'actual') resetPreview(); update(); });
    [$('sourceStage'), $('compareStage')].filter(Boolean).forEach((stage) => {
      stage.classList.add('v19-zoomable');
      stage.addEventListener('wheel', (event) => { if (stage.hidden) return; event.preventDefault(); zoom = Math.max(.25, Math.min(8, zoom * (event.deltaY < 0 ? 1.12 : .89))); update(); }, { passive: false });
      stage.addEventListener('dblclick', () => { resetPreview(); update(); });
      stage.addEventListener('pointerdown', (event) => { if (zoom <= 1) return; panning = true; panStart = { x: event.clientX - panX, y: event.clientY - panY }; stage.classList.add('v19-panning'); stage.setPointerCapture(event.pointerId); });
      stage.addEventListener('pointermove', (event) => { if (!panning) return; panX = event.clientX - panStart.x; panY = event.clientY - panStart.y; transformPreview(); });
      stage.addEventListener('pointerup', () => { panning = false; stage.classList.remove('v19-panning'); });
    });
  }

  function readHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
  function writeHistory(items) { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); renderHistory(); }
  function addHistory(entry) { const items = readHistory(); items.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, createdAt: new Date().toISOString(), ...entry }); writeHistory(items); }
  function renderHistory() {
    const root = $('v19HistoryList'); if (!root) return; const items = readHistory(); root.replaceChildren();
    if (!items.length) { root.innerHTML = '<div class="v19-empty">Chưa có lịch sử xử lý.</div>'; return; }
    items.forEach((item) => { const row = document.createElement('div'); row.className = 'v19-row'; row.innerHTML = `<div><strong>${item.name || 'Output'}</strong><small>${item.preset || 'Custom'} · ${new Date(item.createdAt).toLocaleString()}</small></div><div class="v19-row-actions"><button class="secondary" data-open>Chọn lại</button><button class="danger-text" data-remove>×</button></div>`; row.querySelector('[data-open]').addEventListener('click', () => item.preset && applyPreset(item.preset)); row.querySelector('[data-remove]').addEventListener('click', () => writeHistory(readHistory().filter((entry) => entry.id !== item.id))); root.append(row); });
  }

  function installQueueAndHistory() {
    const previewColumn = document.querySelector('.preview-column'); if (!previewColumn || $('v19BottomGrid')) return;
    const grid = document.createElement('div'); grid.id = 'v19BottomGrid'; grid.className = 'v19-bottom-grid';
    grid.innerHTML = `<section class="v19-queue-card"><div class="v19-card-head"><div><strong>Queue & Batch Manager</strong><small>Kéo nhiều file hoặc dùng Smart Production</small></div><button id="v19AddQueueBtn" class="secondary" type="button">Thêm file</button></div><div id="v19QueueList" class="v19-queue-list"><div class="v19-empty">Chưa có file trong hàng đợi.</div></div></section><section class="v19-history-card"><div class="v19-card-head"><div><strong>Lịch sử gần đây</strong><small>Tối đa ${MAX_HISTORY} mục trên máy này</small></div><button id="v19ClearHistoryBtn" class="danger-text" type="button">Xóa</button></div><div id="v19HistoryList" class="v19-history-list"></div></section>`;
    previewColumn.append(grid);
    $('v19AddQueueBtn').addEventListener('click', async () => { const files = await window.studio.selectBatchInputs?.(); renderQueue(files || []); });
    $('v19ClearHistoryBtn').addEventListener('click', () => writeHistory([]));
    renderHistory();
  }

  function renderQueue(files) {
    const root = $('v19QueueList'); if (!root) return; root.replaceChildren();
    if (!files.length) { root.innerHTML = '<div class="v19-empty">Chưa có file trong hàng đợi.</div>'; return; }
    files.forEach((file, index) => { const row = document.createElement('div'); row.className = 'v19-row'; row.innerHTML = `<div><strong>${file.split(/[\\/]/).pop()}</strong><small>Ảnh ${index + 1} · Sẵn sàng</small></div><span class="v19-badge">Waiting</span>`; root.append(row); });
  }

  function observeResults() {
    const result = $('resultBox'); if (!result) return;
    new MutationObserver(() => { if (result.hidden || !result.textContent.trim()) return; addHistory({ name: $('inputName')?.textContent || 'Output', preset: localStorage.getItem('print-upscale-studio:v19-preset') || 'custom', summary: result.textContent.trim().slice(0, 400) }); }).observe(result, { childList: true, subtree: true, attributes: true });
  }

  function syncMode() { document.body.classList.toggle('v19-model-lab', typeof state !== 'undefined' && state.tool === 'model-lab'); }
  installStyles(); installPresetAndAdvanced(); installPreviewTools(); installQueueAndHistory(); observeResults(); syncMode();
  const originalSelectTool = window.selectTool;
  if (typeof originalSelectTool === 'function' && !window.__v19SelectToolHook) { window.__v19SelectToolHook = true; window.selectTool = function v19SelectTool(tool) { originalSelectTool(tool); syncMode(); }; }
})();