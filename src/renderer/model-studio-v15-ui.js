(() => {
  const MODEL_LABELS = {
    'high-fidelity-4x': 'High Fidelity',
    'remacri-4x': 'Packaging / Remacri',
    'realesrgan-x4plus': 'RealESRGAN Detail',
    'ultrasharp-4x': 'UltraSharp',
    'digital-art-4x': 'Digital Art'
  };

  const PRESET_BY_MODEL = {
    'high-fidelity-4x': 'current-photo',
    'remacri-4x': 'current-packaging',
    'realesrgan-x4plus': 'official-detail'
  };

  let lastInputPath = null;
  let analysisToken = 0;

  function clamp(value, minimum = 0, maximum = 100) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
  }

  function scoreModels(report) {
    const m = report.metrics || {};
    const type = report.classification || 'photo';
    const edge = Number(m.edgeDensity || 0);
    const saturation = Number(m.averageSaturation || 0);
    const contrast = Number(m.contrast || 0);
    const barcode = Boolean(report.barcode?.detected);
    const scores = {
      'high-fidelity-4x': 72,
      'remacri-4x': 58,
      'realesrgan-x4plus': 55,
      'ultrasharp-4x': 48,
      'digital-art-4x': 45
    };

    if (type === 'photo') {
      scores['high-fidelity-4x'] += 20;
      scores['realesrgan-x4plus'] += clamp(edge * 55, 0, 12);
    }
    if (type === 'packaging-artwork') {
      scores['remacri-4x'] += 32;
      scores['high-fidelity-4x'] += 14;
      scores['realesrgan-x4plus'] -= 5;
    }
    if (type === 'text-line-art') {
      scores['high-fidelity-4x'] += 24;
      scores['remacri-4x'] += 18;
      scores['ultrasharp-4x'] -= 10;
    }
    if (type === 'detail-rich') {
      scores['realesrgan-x4plus'] += 30;
      scores['ultrasharp-4x'] += 12;
      scores['high-fidelity-4x'] += 8;
    }
    if (barcode) {
      scores['remacri-4x'] += 12;
      scores['high-fidelity-4x'] += 8;
      scores['ultrasharp-4x'] -= 14;
    }
    if (saturation < 0.1 && edge > 0.12) {
      scores['high-fidelity-4x'] += 8;
      scores['remacri-4x'] += 6;
    }
    if (contrast > 70) scores['ultrasharp-4x'] -= 6;

    return Object.entries(scores)
      .map(([model, score]) => ({ model, score: clamp(score) }))
      .sort((a, b) => b.score - a.score);
  }

  function printScore(report) {
    const minimum = Math.min(report.metadata.width, report.metadata.height);
    const edge = Number(report.metrics?.edgeDensity || 0);
    const contrast = Number(report.metrics?.contrast || 0);
    let score = 58;
    if (minimum >= 1600) score += 22;
    else if (minimum >= 900) score += 14;
    else if (minimum >= 500) score += 7;
    if (edge >= 0.08 && edge <= 0.35) score += 8;
    if (contrast >= 25 && contrast <= 75) score += 6;
    if (report.barcode?.detected) score += 3;
    if (report.output?.megapixels > 300) score -= 18;
    return clamp(score);
  }

  function typeLabel(type) {
    return {
      photo: 'Ảnh chụp',
      'packaging-artwork': 'Bao bì / artwork',
      'text-line-art': 'Chữ / line art',
      'detail-rich': 'Ảnh nhiều chi tiết'
    }[type] || 'Ảnh hỗn hợp';
  }

  function installStyles() {
    if (document.getElementById('modelStudioV15Styles')) return;
    const style = document.createElement('style');
    style.id = 'modelStudioV15Styles';
    style.textContent = `
      .model-intelligence-card{border:1px solid #33404c;border-radius:13px;background:#10151b;padding:13px;margin-bottom:12px;display:grid;gap:11px}
      .model-intelligence-card[hidden]{display:none}
      .mi-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.mi-head h3{margin:2px 0 0;font-size:14px}.mi-kicker{font-size:8px;letter-spacing:.15em;color:#7f8b99;font-weight:800}
      .mi-score{min-width:58px;height:58px;border-radius:50%;display:grid;place-items:center;border:2px solid #73b7ff;background:#121d28;font-size:17px;font-weight:900}.mi-score small{font-size:8px;color:#8f9baa;margin-left:1px}
      .mi-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.mi-fact{background:#171d24;border-radius:9px;padding:8px}.mi-fact small{display:block;color:#7f8995;font-size:7px;letter-spacing:.08em}.mi-fact strong{display:block;margin-top:3px;font-size:10px;color:#e8edf3}
      .mi-recommend{border-left:3px solid #73b7ff;padding:8px 9px;background:#131b24;border-radius:7px}.mi-recommend strong{font-size:11px}.mi-recommend small{display:block;margin-top:4px;color:#9ba6b3;line-height:1.45}
      .mi-ranking{display:grid;gap:5px}.mi-rank{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:center;font-size:9px}.mi-bar{height:5px;border-radius:99px;background:#232c36;overflow:hidden;margin-top:3px}.mi-bar i{display:block;height:100%;background:#73b7ff}.mi-rank b{font-size:9px;text-align:right}
      .mi-actions{display:flex;gap:7px}.mi-actions button{flex:1;padding:8px;font-size:9px}.mi-status{font-size:9px;color:#8d98a5;line-height:1.4}.mi-status.error{color:#ff9fa8}
    `;
    document.head.append(style);
  }

  function installCard() {
    const settings = document.getElementById('benchmarkSettings');
    if (!settings || document.getElementById('modelIntelligenceCard')) return;
    const card = document.createElement('section');
    card.id = 'modelIntelligenceCard';
    card.className = 'model-intelligence-card';
    card.innerHTML = `
      <div class="mi-head"><div><div class="mi-kicker">MODEL STUDIO INTELLIGENCE V15</div><h3>Phân tích ảnh & đề xuất model</h3></div><div id="miPrintScore" class="mi-score">—</div></div>
      <div class="mi-facts"><div class="mi-fact"><small>LOẠI ẢNH</small><strong id="miType">—</strong></div><div class="mi-fact"><small>SCALE</small><strong id="miScale">—</strong></div><div class="mi-fact"><small>ĐẦU RA</small><strong id="miOutput">—</strong></div></div>
      <div class="mi-recommend"><strong id="miRecommendation">Chưa phân tích</strong><small id="miReason">Chọn ảnh để Model Studio tự đánh giá.</small></div>
      <div id="miRanking" class="mi-ranking"></div>
      <div class="mi-actions"><button id="miAnalyzeBtn" class="secondary" type="button">Phân tích lại</button><button id="miApplyBtn" class="primary" type="button" disabled>Áp dụng đề xuất</button></div>
      <div id="miStatus" class="mi-status">Phân tích chạy hoàn toàn local.</div>`;
    settings.insertAdjacentElement('afterbegin', card);
    document.getElementById('miAnalyzeBtn').addEventListener('click', analyzeCurrentInput);
    document.getElementById('miApplyBtn').addEventListener('click', applyRecommendation);
  }

  function renderRanking(scores) {
    const root = document.getElementById('miRanking');
    root.replaceChildren();
    for (const item of scores.slice(0, 4)) {
      const row = document.createElement('div');
      row.className = 'mi-rank';
      row.innerHTML = `<div><span>${MODEL_LABELS[item.model] || item.model}</span><div class="mi-bar"><i style="width:${item.score}%"></i></div></div><b>${item.score}</b>`;
      root.append(row);
    }
  }

  function applyRecommendation() {
    const card = document.getElementById('modelIntelligenceCard');
    const model = card?.dataset.recommendedModel;
    const scale = card?.dataset.recommendedScale;
    if (!model) return;
    const presetId = PRESET_BY_MODEL[model];
    if (presetId) {
      document.querySelectorAll('.benchmark-preset').forEach((input) => { input.checked = input.value === presetId || input.value === 'packaging-hybrid' && model === 'remacri-4x'; });
    }
    if (scale && document.getElementById('scaleSelect')) document.getElementById('scaleSelect').value = scale;
    document.getElementById('miStatus').textContent = `Đã áp dụng ${MODEL_LABELS[model] || model} · ${scale}×. Có thể chạy Model Studio.`;
  }

  async function analyzeCurrentInput() {
    if (!state?.inputPath) return;
    const token = ++analysisToken;
    const status = document.getElementById('miStatus');
    status.classList.remove('error');
    status.textContent = 'Đang phân tích cạnh, độ tương phản, màu và khả năng in...';
    try {
      const report = await window.studio.analyzeImage({ inputPath: state.inputPath, options: { scale: Number(document.getElementById('scaleSelect')?.value || 4), format: 'png' } });
      if (token !== analysisToken) return;
      const scores = scoreModels(report);
      const best = scores[0];
      const score = printScore(report);
      const card = document.getElementById('modelIntelligenceCard');
      card.dataset.recommendedModel = best.model;
      card.dataset.recommendedScale = String(report.recommendation?.scale || 4);
      document.getElementById('miPrintScore').innerHTML = `${score}<small>/100</small>`;
      document.getElementById('miType').textContent = typeLabel(report.classification);
      document.getElementById('miScale').textContent = `${report.recommendation?.scale || 4}×`;
      document.getElementById('miOutput').textContent = `${report.output?.megapixels || '—'} MP`;
      document.getElementById('miRecommendation').textContent = `${MODEL_LABELS[best.model] || best.model} · ${best.score}/100`;
      document.getElementById('miReason').textContent = report.recommendation?.reason || 'Model có điểm phù hợp cao nhất với cấu trúc ảnh.';
      renderRanking(scores);
      document.getElementById('miApplyBtn').disabled = false;
      status.textContent = report.warnings?.length ? report.warnings.join(' ') : 'Sẵn sàng. Áp dụng đề xuất hoặc tự chọn model để benchmark.';
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message || String(error);
    }
  }

  function watchInput() {
    const observer = new MutationObserver(() => {
      if (!state?.inputPath || state.inputPath === lastInputPath) return;
      lastInputPath = state.inputPath;
      if (state.tool === 'model-lab') analyzeCurrentInput();
    });
    const name = document.getElementById('inputName');
    if (name) observer.observe(name, { childList: true, characterData: true, subtree: true });
    document.querySelectorAll('[data-tool="model-lab"]').forEach((button) => button.addEventListener('click', () => {
      setTimeout(() => { if (state.inputPath) analyzeCurrentInput(); }, 0);
    }));
  }

  installStyles();
  installCard();
  watchInput();
})();
