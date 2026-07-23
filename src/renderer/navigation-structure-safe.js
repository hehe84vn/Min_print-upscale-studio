(() => {
  const VERSION_LABEL = 'Studio V2.9.4 · Tối ưu hình ảnh cho in ấn';
  const QUICK_VECTOR_NOTICE = 'Tạo vector sơ bộ cho logo, con dấu và line art. Hãy kiểm tra và hoàn thiện trong Illustrator trước khi sản xuất.';

  const TOOL_COPY = {
    upscale: {
      title: 'Local Enhance',
      subtitle: 'Nhanh · riêng tư · không phí API',
      description: 'Tăng kích thước và độ nét bằng bộ xử lý AI trên thiết bị.',
      badge: 'Xử lý hoàn toàn trên thiết bị',
      runLabel: 'Xử lý ảnh'
    },
    'ai-enhance': {
      title: 'Cloud Enhance',
      subtitle: 'Tái tạo chi tiết bằng AI Cloud',
      description: 'Tái tạo chi tiết bằng Gemini hoặc OpenAI qua AI Cloud.',
      badge: 'Ảnh được gửi tới AI Cloud',
      runLabel: 'Tăng cường bằng AI',
      cloud: true
    },
    'model-lab': {
      title: 'Model Studio',
      subtitle: 'So sánh và chọn model nâng cấp',
      description: 'So sánh và chọn model nâng cấp phù hợp cho ảnh và artwork.',
      badge: 'Nhiều model · xử lý local',
      runLabel: 'Chạy Model Studio'
    },
    restore: {
      title: 'Safe Restore',
      subtitle: 'Khử nhiễu · phục hồi màu',
      description: 'Phục hồi ảnh nhẹ theo hướng bảo toàn, không sinh chi tiết giả.',
      badge: 'Xử lý hoàn toàn trên thiết bị',
      runLabel: 'Xử lý ảnh'
    },
    'text-print': {
      title: 'Text & Artwork',
      subtitle: 'Tăng nét · giữ nguyên glyph',
      description: 'Làm nét chữ và artwork raster mà không OCR hoặc thay font.',
      badge: 'Xử lý hoàn toàn trên thiết bị',
      runLabel: 'Xử lý ảnh'
    },
    'vector-logo': {
      title: 'Quick Vector',
      subtitle: 'Vector sơ bộ · cần kiểm tra',
      description: 'Tạo vector sơ bộ cho logo, con dấu và line art.',
      badge: 'Vector hóa local · cần kiểm tra',
      runLabel: 'Tạo SVG vector'
    },
    'smart-production': {
      title: 'Smart Production',
      subtitle: 'Phân tích · xếp hàng · tối đa 8×',
      description: 'Smart Analyzer, Target Print Size và Batch Queue ổn định đến tối đa 8×.',
      badge: 'Batch local · tối đa 8×',
      tag: 'BATCH'
    }
  };

  const GROUPS = [
    { label: 'NÂNG CẤP HÌNH ẢNH', tools: ['upscale', 'ai-enhance', 'model-lab'] },
    { label: 'XỬ LÝ CHUYÊN BIỆT', tools: ['restore', 'text-print', 'vector-logo'] },
    { label: 'SẢN XUẤT', tools: ['smart-production'] }
  ];

  const LEGACY_COPY = [
    ['Model Lab · Experimental', 'Model Studio'],
    ['MODEL LAB RESULTS', 'MODEL STUDIO RESULTS'],
    ['Model Lab Pro', 'Model Studio'],
    ['Model Lab', 'Model Studio'],
    ['AI Enhance', 'Cloud Enhance'],
    ['Restore Safe', 'Safe Restore'],
    ['Vector Logo', 'Quick Vector']
  ];

  let restructuring = false;

  function installStyles() {
    if (document.getElementById('navigationStructureStyles')) return;
    const style = document.createElement('style');
    style.id = 'navigationStructureStyles';
    style.textContent = `
      .tool-nav { display: block; min-height: 0; overflow-y: auto; padding-right: 2px; }
      .nav-group { display: grid; gap: 4px; margin-bottom: 14px; }
      .nav-group:last-child { margin-bottom: 0; }
      .nav-group-label, .sidebar-system-label { margin: 0 12px 4px; color: #67717d; font-size: 9px; font-weight: 800; letter-spacing: .14em; }
      .nav-item { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 10px 12px; }
      .nav-item > b { display: none !important; }
      .nav-item > span { min-width: 0; }
      .nav-item small { margin-top: 3px; }
      .lab-nav.active { background: var(--panel-2); border-color: var(--line); }
      .lab-nav.active b { color: var(--accent); }
      .sidebar-system-group { margin-top: auto; display: grid; gap: 4px; }
      .sidebar-system-group .settings-button { margin-top: 0; }
      @media (max-height: 760px) {
        .brand { padding-bottom: 14px; }
        .nav-group { margin-bottom: 9px; }
        .nav-item { padding-top: 8px; padding-bottom: 8px; }
        .engine-card { padding: 9px 11px; }
      }
    `;
    document.head.append(style);
  }

  function buttonFor(tool) {
    return document.querySelector(`.nav-item[data-tool="${tool}"]`);
  }

  function updateButton(button, copy) {
    if (!button || !copy) return;
    button.querySelector(':scope > b')?.remove();
    button.classList.remove('lab-nav');

    let content = button.querySelector(':scope > span');
    if (!content) {
      content = document.createElement('span');
      button.append(content);
    }

    content.replaceChildren(document.createTextNode(copy.title));
    if (copy.tag) {
      const tag = document.createElement('em');
      tag.className = 'production-tag';
      tag.textContent = copy.tag;
      content.append(' ', tag);
    }

    const subtitle = document.createElement('small');
    subtitle.textContent = copy.subtitle;
    content.append(subtitle);
  }

  function groupElement(label, tools) {
    const section = document.createElement('section');
    section.className = 'nav-group';
    section.dataset.group = label;

    const heading = document.createElement('div');
    heading.className = 'nav-group-label';
    heading.textContent = label;
    section.append(heading);

    for (const tool of tools) {
      const button = buttonFor(tool);
      if (!button) continue;
      updateButton(button, TOOL_COPY[tool]);
      section.append(button);
    }
    return section;
  }

  function installSystemGroup() {
    const sidebar = document.querySelector('.sidebar');
    const settingsButton = document.getElementById('appSettingsBtn');
    if (!sidebar || !settingsButton) return;

    let group = sidebar.querySelector('.sidebar-system-group');
    if (!group) {
      group = document.createElement('section');
      group.className = 'sidebar-system-group';
      const label = document.createElement('div');
      label.className = 'sidebar-system-label';
      label.textContent = 'HỆ THỐNG';
      group.append(label);
    }

    group.append(settingsButton);
    const engineCard = sidebar.querySelector('.engine-card');
    if (engineCard) engineCard.before(group);
    else sidebar.append(group);
  }

  function activeTool() {
    return document.querySelector('.nav-item.active')?.dataset.tool || 'upscale';
  }

  function normalizedText(value) {
    let output = String(value || '');
    for (const [legacy, replacement] of LEGACY_COPY) output = output.replaceAll(legacy, replacement);
    return output;
  }

  function normalizeElementText(element) {
    if (!element) return;
    const next = normalizedText(element.textContent);
    if (next !== element.textContent) element.textContent = next;
  }

  function applyStaticCopy() {
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion && brandVersion.textContent !== VERSION_LABEL) brandVersion.textContent = VERSION_LABEL;

    const benchmarkEyebrow = document.querySelector('#benchmarkSummaryCard .eyebrow');
    if (benchmarkEyebrow && benchmarkEyebrow.textContent !== 'MODEL STUDIO RESULTS') {
      benchmarkEyebrow.textContent = 'MODEL STUDIO RESULTS';
    }

    const vectorNotice = document.querySelector('#vectorSettings .notice');
    if (vectorNotice && vectorNotice.textContent !== QUICK_VECTOR_NOTICE) {
      vectorNotice.textContent = QUICK_VECTOR_NOTICE;
    }

    normalizeElementText(document.getElementById('engineStatus'));
    normalizeElementText(document.getElementById('resultBox'));
  }

  function syncToolPresentation(tool = activeTool()) {
    const copy = TOOL_COPY[tool] || TOOL_COPY.upscale;
    const title = document.getElementById('toolTitle');
    const description = document.getElementById('toolDescription');
    const badge = document.getElementById('privacyBadge');
    const runButton = document.getElementById('runBtn');
    const outputLabel = document.getElementById('outputLabel');

    if (title && title.textContent !== copy.title) title.textContent = copy.title;
    if (description && description.textContent !== copy.description) description.textContent = copy.description;
    if (badge) {
      if (badge.textContent !== copy.badge) badge.textContent = copy.badge;
      badge.classList.toggle('cloud', Boolean(copy.cloud));
      badge.classList.remove('lab');
    }
    if (runButton && tool !== 'smart-production' && runButton.textContent !== copy.runLabel) {
      runButton.textContent = copy.runLabel;
    }
    if (outputLabel && tool === 'model-lab' && outputLabel.textContent !== 'Thư mục lưu kết quả so sánh') {
      outputLabel.textContent = 'Thư mục lưu kết quả so sánh';
    }

    const brandVersion = document.querySelector('.brand span');
    if (brandVersion && brandVersion.textContent !== VERSION_LABEL) brandVersion.textContent = VERSION_LABEL;
    document.title = `Print Upscale Studio V2.9.4 · ${copy.title}`;
  }

  function observeTextTarget(element) {
    if (!element || element.dataset.copyObserverBound === 'true') return;
    element.dataset.copyObserverBound = 'true';
    const observer = new MutationObserver(() => normalizeElementText(element));
    observer.observe(element, { subtree: true, childList: true, characterData: true });
  }

  function bindCopySync() {
    document.querySelectorAll('.nav-item').forEach((button) => {
      if (button.dataset.copySyncBound === 'true') return;
      button.dataset.copySyncBound = 'true';
      button.addEventListener('click', () => {
        window.setTimeout(() => {
          applyStaticCopy();
          syncToolPresentation(button.dataset.tool);
        }, 0);
      });
    });

    observeTextTarget(document.getElementById('engineStatus'));
    observeTextTarget(document.getElementById('resultBox'));
  }

  function restructureNav() {
    const nav = document.getElementById('toolNav');
    if (!nav || restructuring) return false;
    const expectedTools = GROUPS.flatMap((group) => group.tools);
    if (!expectedTools.every((tool) => buttonFor(tool))) return false;

    restructuring = true;
    try {
      const groups = GROUPS.map((group) => groupElement(group.label, group.tools));
      nav.replaceChildren(...groups);
      installSystemGroup();
      applyStaticCopy();
      syncToolPresentation();
      bindCopySync();
      return true;
    } finally {
      restructuring = false;
    }
  }

  function initialize(attempt = 0) {
    installStyles();
    if (!restructureNav() && attempt < 30) {
      window.setTimeout(() => initialize(attempt + 1), 50);
    }
  }

  initialize();
})();