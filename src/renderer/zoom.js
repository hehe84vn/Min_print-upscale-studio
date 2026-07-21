(() => {
  const $ = (id) => document.getElementById(id);
  const sourceStage = $('sourceStage');
  const compareStage = $('compareStage');
  const previewImage = $('previewImage');
  const beforeImage = $('beforeImage');
  const afterImage = $('afterImage');
  const compareControls = $('compareControls');
  const fileStrip = document.querySelector('.file-strip');

  if (!sourceStage || !compareStage || !previewImage || !beforeImage || !afterImage || !fileStrip) return;

  const view = {
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0
  };

  const toolbar = document.createElement('div');
  toolbar.id = 'zoomControls';
  toolbar.className = 'zoom-controls';
  toolbar.hidden = true;
  toolbar.innerHTML = `
    <div class="zoom-label">SOI CHI TIẾT</div>
    <button class="zoom-button" type="button" data-zoom="fit">Fit</button>
    <button class="zoom-button" type="button" data-zoom="1">100%</button>
    <button class="zoom-button" type="button" data-zoom="2">200%</button>
    <button class="zoom-button" type="button" data-zoom="4">400%</button>
    <button id="zoomOutBtn" class="zoom-icon-button" type="button" aria-label="Thu nhỏ">−</button>
    <input id="zoomRange" type="range" min="100" max="800" step="25" value="100" aria-label="Mức zoom" />
    <button id="zoomInBtn" class="zoom-icon-button" type="button" aria-label="Phóng lớn">＋</button>
    <output id="zoomValue">100%</output>
    <button id="toggleCompareViewBtn" class="zoom-view-button" type="button" hidden>Chỉ ảnh gốc</button>
  `;
  fileStrip.before(toolbar);

  const style = document.createElement('style');
  style.textContent = `
    .zoom-controls {
      min-height: 48px;
      border-top: 1px solid var(--line);
      display: grid;
      grid-template-columns: auto repeat(4, auto) auto minmax(110px, 1fr) auto 48px auto;
      gap: 7px;
      align-items: center;
      padding: 8px 14px;
      background: #12151a;
    }
    .zoom-label { color: var(--muted); font-size: 9px; font-weight: 800; letter-spacing: .11em; white-space: nowrap; }
    .zoom-button, .zoom-icon-button, .zoom-view-button {
      border: 1px solid #343b45;
      background: #20252c;
      color: #d7dce2;
      border-radius: 7px;
      min-height: 28px;
      padding: 5px 8px;
      font-size: 10px;
      font-weight: 750;
      cursor: pointer;
    }
    .zoom-button:hover, .zoom-icon-button:hover, .zoom-view-button:hover { border-color: var(--accent); }
    .zoom-button.active { border-color: var(--accent); color: var(--accent); background: #192015; }
    .zoom-icon-button { width: 30px; padding: 0; font-size: 15px; }
    .zoom-view-button { color: var(--accent); white-space: nowrap; }
    #zoomRange { width: 100%; accent-color: var(--accent); }
    #zoomValue { color: var(--accent); font-size: 10px; font-weight: 800; text-align: right; }
    .source-stage, .compare-stage { overflow: hidden !important; touch-action: none; }
    .source-stage.zoomable, .compare-stage.zoomable { cursor: grab; }
    .source-stage.zoomable.dragging, .compare-stage.zoomable.dragging { cursor: grabbing; }
    #previewImage, .compare-image {
      transform-origin: center center;
      will-change: transform;
      pointer-events: none;
    }
    #previewImage {
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      object-fit: contain;
    }
    @media (max-width: 1180px) {
      .zoom-controls { grid-template-columns: repeat(4, auto) auto minmax(100px, 1fr) auto 45px; }
      .zoom-label, .zoom-view-button { display: none; }
    }
  `;
  document.head.append(style);

  const zoomRange = $('zoomRange');
  const zoomValue = $('zoomValue');
  const zoomOutBtn = $('zoomOutBtn');
  const zoomInBtn = $('zoomInBtn');
  const toggleCompareViewBtn = $('toggleCompareViewBtn');

  function activeStage() {
    return compareStage.hidden ? sourceStage : compareStage;
  }

  function hasResult() {
    return Boolean(afterImage.getAttribute('src'));
  }

  function clampPan() {
    if (view.zoom <= 1) {
      view.panX = 0;
      view.panY = 0;
      return;
    }

    const stage = activeStage();
    const maxX = Math.max(0, (stage.clientWidth * (view.zoom - 1)) / 2);
    const maxY = Math.max(0, (stage.clientHeight * (view.zoom - 1)) / 2);
    view.panX = Math.max(-maxX, Math.min(maxX, view.panX));
    view.panY = Math.max(-maxY, Math.min(maxY, view.panY));
  }

  function applyTransform() {
    clampPan();
    const transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    previewImage.style.transform = transform;
    beforeImage.style.transform = transform;
    afterImage.style.transform = transform;

    const percentage = Math.round(view.zoom * 100);
    zoomRange.value = String(percentage);
    zoomValue.textContent = `${percentage}%`;

    document.querySelectorAll('.zoom-button[data-zoom]').forEach((button) => {
      const target = button.dataset.zoom === 'fit' ? 1 : Number(button.dataset.zoom);
      button.classList.toggle('active', Math.abs(view.zoom - target) < 0.001 && view.panX === 0 && view.panY === 0);
    });

    [sourceStage, compareStage].forEach((stage) => {
      stage.classList.toggle('zoomable', view.zoom > 1);
      stage.classList.toggle('dragging', view.dragging && stage === activeStage());
    });
  }

  function setZoom(nextZoom, resetPan = false) {
    view.zoom = Math.max(1, Math.min(8, Number(nextZoom) || 1));
    if (resetPan || view.zoom === 1) {
      view.panX = 0;
      view.panY = 0;
    }
    applyTransform();
  }

  function fitView() {
    setZoom(1, true);
  }

  function syncVisibility() {
    const hasImage = Boolean(previewImage.getAttribute('src'));
    toolbar.hidden = !hasImage;
    toggleCompareViewBtn.hidden = !hasResult();
    toggleCompareViewBtn.textContent = compareStage.hidden ? 'Đối ảnh' : 'Chỉ ảnh gốc';
  }

  function showComparisonView() {
    if (!hasResult()) return;
    sourceStage.hidden = true;
    compareStage.hidden = false;
    compareControls.hidden = false;
    toggleCompareViewBtn.textContent = 'Chỉ ảnh gốc';
    applyTransform();
  }

  function showSourceView() {
    sourceStage.hidden = false;
    compareStage.hidden = true;
    compareControls.hidden = true;
    toggleCompareViewBtn.textContent = 'Đối ảnh';
    applyTransform();
  }

  toolbar.addEventListener('click', (event) => {
    const zoomButton = event.target.closest('[data-zoom]');
    if (zoomButton) {
      const value = zoomButton.dataset.zoom;
      setZoom(value === 'fit' ? 1 : Number(value), true);
    }
  });

  zoomOutBtn.addEventListener('click', () => setZoom(view.zoom - 0.25));
  zoomInBtn.addEventListener('click', () => setZoom(view.zoom + 0.25));
  zoomRange.addEventListener('input', () => setZoom(Number(zoomRange.value) / 100));
  toggleCompareViewBtn.addEventListener('click', () => {
    if (compareStage.hidden) showComparisonView();
    else showSourceView();
  });

  [sourceStage, compareStage].forEach((stage) => {
    stage.addEventListener('wheel', (event) => {
      if (toolbar.hidden) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 0.25 : -0.25;
      setZoom(view.zoom + direction);
    }, { passive: false });

    stage.addEventListener('dblclick', () => {
      setZoom(view.zoom > 1 ? 1 : 2, true);
    });

    stage.addEventListener('pointerdown', (event) => {
      if (view.zoom <= 1 || stage !== activeStage()) return;
      view.dragging = true;
      view.pointerId = event.pointerId;
      view.startX = event.clientX;
      view.startY = event.clientY;
      view.startPanX = view.panX;
      view.startPanY = view.panY;
      stage.setPointerCapture(event.pointerId);
      applyTransform();
    });

    stage.addEventListener('pointermove', (event) => {
      if (!view.dragging || event.pointerId !== view.pointerId || stage !== activeStage()) return;
      view.panX = view.startPanX + (event.clientX - view.startX);
      view.panY = view.startPanY + (event.clientY - view.startY);
      applyTransform();
    });

    const stopDragging = (event) => {
      if (!view.dragging || event.pointerId !== view.pointerId) return;
      view.dragging = false;
      view.pointerId = null;
      applyTransform();
    };
    stage.addEventListener('pointerup', stopDragging);
    stage.addEventListener('pointercancel', stopDragging);
    stage.addEventListener('lostpointercapture', () => {
      view.dragging = false;
      view.pointerId = null;
      applyTransform();
    });
  });

  const observer = new MutationObserver((mutations) => {
    const imageChanged = mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'src');
    if (imageChanged) fitView();
    syncVisibility();
  });

  observer.observe(sourceStage, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(compareStage, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(compareControls, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(previewImage, { attributes: true, attributeFilter: ['src'] });
  observer.observe(beforeImage, { attributes: true, attributeFilter: ['src'] });
  observer.observe(afterImage, { attributes: true, attributeFilter: ['src'] });

  window.addEventListener('resize', applyTransform);
  syncVisibility();
  fitView();
})();