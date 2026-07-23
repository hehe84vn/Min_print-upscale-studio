(() => {
  const get = (id) => document.getElementById(id);
  const settings = get('vectorSettings');
  const afterImage = get('afterImage');
  const afterClip = get('afterClip');
  if (!settings || !afterImage || !afterClip) return;

  const MAX_RENDERED_NODES = 2500;
  let requestId = 0;

  function installStyles() {
    if (get('vectorNodePreviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'vectorNodePreviewStyles';
    style.textContent = `
      .vector-node-preview-row { border: 1px solid #394c5b; background: #101820; border-radius: 9px; padding: 9px; }
      .vector-node-preview-row span { display: flex; flex-direction: column; gap: 2px; }
      .vector-node-preview-row small { color: #8395a4; font-size: 9px; line-height: 1.35; }
      .vector-node-summary { margin-top: 6px; color: #9fb4c5; font-size: 9px; line-height: 1.4; }
      .vector-node-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4; }
      .vector-node-overlay circle { fill: #ff3b30; stroke: #fff; stroke-width: .45; vector-effect: non-scaling-stroke; }
      .vector-node-overlay .move-node { fill: #00a7ff; }
      .vector-node-overlay .sampled-node { opacity: .82; }
    `;
    document.head.append(style);
  }

  function installControls() {
    if (get('vectorNodePreview')) return;
    const row = document.createElement('label');
    row.className = 'check-row vector-node-preview-row';
    row.innerHTML = `
      <input id="vectorNodePreview" type="checkbox">
      <span>Hiện anchor point sau cleanup<small>Đỏ: anchor · xanh: điểm bắt đầu path. Chỉ là lớp preview, không thay đổi file SVG.</small></span>
    `;
    const summary = document.createElement('p');
    summary.id = 'vectorNodeSummary';
    summary.className = 'vector-node-summary';
    summary.textContent = 'Node Preview sẽ xuất hiện sau khi tạo SVG.';
    row.append(summary);
    settings.append(row);
    get('vectorNodePreview').addEventListener('change', refreshOverlay);
  }

  function tokenizePath(data) {
    return String(data || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  }

  function extractAnchors(data) {
    const counts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
    const tokens = tokenizePath(data);
    const anchors = [];
    let index = 0;
    let command = null;
    let current = { x: 0, y: 0 };
    let start = { x: 0, y: 0 };

    while (index < tokens.length) {
      if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
      if (!command) break;
      const upper = command.toUpperCase();
      const relative = command !== upper;
      const count = counts[upper];
      if (count == null) break;
      if (upper === 'Z') {
        current = { ...start };
        command = null;
        continue;
      }
      if (index + count > tokens.length) break;
      const values = tokens.slice(index, index + count).map(Number);
      index += count;
      const point = (x, y) => relative ? { x: current.x + x, y: current.y + y } : { x, y };
      let next = null;
      if (upper === 'M' || upper === 'L' || upper === 'T') next = point(values[0], values[1]);
      else if (upper === 'H') next = { x: relative ? current.x + values[0] : values[0], y: current.y };
      else if (upper === 'V') next = { x: current.x, y: relative ? current.y + values[0] : values[0] };
      else if (upper === 'C') next = point(values[4], values[5]);
      else if (upper === 'S' || upper === 'Q') next = point(values[2], values[3]);
      else if (upper === 'A') next = point(values[5], values[6]);
      if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y)) break;
      anchors.push({ ...next, move: upper === 'M' });
      current = next;
      if (upper === 'M') {
        start = { ...next };
        command = relative ? 'l' : 'L';
      }
    }
    return anchors;
  }

  function parseSvg(svgText) {
    const documentNode = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (documentNode.querySelector('parsererror')) throw new Error('SVG preview không hợp lệ.');
    const root = documentNode.documentElement;
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
    const width = Number(root.getAttribute('width')) || 1000;
    const height = Number(root.getAttribute('height')) || 1000;
    const box = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? viewBox : [0, 0, width, height];
    const anchors = [...root.querySelectorAll('path[d]')].flatMap((path) => extractAnchors(path.getAttribute('d')));
    return { box, anchors, pathCount: root.querySelectorAll('path[d]').length };
  }

  function clearOverlay(message = null) {
    get('vectorNodeOverlay')?.remove();
    if (message) get('vectorNodeSummary').textContent = message;
  }

  async function refreshOverlay() {
    const enabled = get('vectorNodePreview')?.checked;
    const source = afterImage.getAttribute('src') || '';
    if (!enabled) {
      clearOverlay(source.toLowerCase().includes('.svg') ? 'Node Preview đang tắt.' : 'Tạo SVG để xem anchor point.');
      return;
    }
    if (!source.toLowerCase().includes('.svg')) {
      clearOverlay('Preview hiện tại không phải SVG.');
      return;
    }

    const activeRequest = ++requestId;
    clearOverlay('Đang đọc anchor point...');
    try {
      const response = await fetch(source, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseSvg(await response.text());
      if (activeRequest !== requestId) return;
      const step = Math.max(1, Math.ceil(parsed.anchors.length / MAX_RENDERED_NODES));
      const visible = parsed.anchors.filter((_point, index) => index % step === 0);
      const [x, y, width, height] = parsed.box;
      const radius = Math.max(width, height) * 0.0022;
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.id = 'vectorNodeOverlay';
      overlay.classList.add('vector-node-overlay');
      overlay.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      overlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const fragment = document.createDocumentFragment();
      for (const anchor of visible) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', anchor.x);
        circle.setAttribute('cy', anchor.y);
        circle.setAttribute('r', radius);
        if (anchor.move) circle.classList.add('move-node');
        if (step > 1) circle.classList.add('sampled-node');
        fragment.append(circle);
      }
      overlay.append(fragment);
      afterClip.append(overlay);
      get('vectorNodeSummary').textContent = step > 1
        ? `${parsed.anchors.length} anchor · ${parsed.pathCount} path · đang hiển thị mẫu ${visible.length} điểm để giữ preview mượt.`
        : `${parsed.anchors.length} anchor · ${parsed.pathCount} path · hiển thị đầy đủ.`;
    } catch (error) {
      clearOverlay(`Không đọc được node preview: ${error.message || error}`);
    }
  }

  installStyles();
  installControls();
  new MutationObserver(refreshOverlay).observe(afterImage, { attributes: true, attributeFilter: ['src'] });
})();
