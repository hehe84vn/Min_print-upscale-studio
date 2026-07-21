const state = {
  tool: 'upscale',
  inputPath: null,
  outputPath: null,
  busy: false,
  engine: null,
  aiSettings: null,
  sourceUrl: null,
  resultUrl: null,
  benchmark: {
    outputRoot: null,
    sessionDirectory: null,
    referencePath: null,
    results: [],
    items: []
  }
};

const toolInfo = {
  upscale: ['Local Enhance', 'Tăng kích thước và độ nét bằng bộ xử lý AI trên thiết bị.'],
  'ai-enhance': ['AI Enhance', 'Tái tạo chi tiết bằng Gemini hoặc OpenAI với mức kiểm soát phù hợp.'],
  restore: ['Restore Safe', 'Phục hồi ảnh nhẹ theo hướng bảo toàn, không sinh chi tiết giả.'],
  'text-print': ['Text & Artwork', 'Làm nét chữ và artwork raster mà không OCR hoặc thay font.'],
  'vector-logo': ['Vector Logo', 'Chuyển logo màu, con dấu hoặc line art thành SVG vector.'],
  'model-lab': ['Model Lab · Experimental', 'Chạy cùng một ảnh qua nhiều model local để so sánh với Photoshop và chọn pipeline phù hợp cho bao bì.']
};

const providerModels = {
  gemini: [
    ['gemini-3.1-flash-image', 'Nano Banana 2 · cân bằng'],
    ['gemini-3-pro-image', 'Nano Banana Pro · chất lượng cao']
  ],
  openai: [
    ['gpt-image-2', 'GPT Image 2']
  ]
};

const $ = (id) => document.getElementById(id);
const fileName = (value) => value ? value.replaceAll('\\', '/').split('/').pop() : '';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} giây`;
  return `${Math.floor(seconds / 60)} phút ${Math.round(seconds % 60)} giây`;
}

function selectedAiMode() {
  return document.querySelector('input[name="aiMode"]:checked')?.value || 'safe';
}

function syncOutputUi() {
  if (state.tool === 'model-lab') {
    $('outputLabel').textContent = 'Thư mục lưu benchmark';
    $('outputName').textContent = state.benchmark.outputRoot ? fileName(state.benchmark.outputRoot) : 'Chọn thư mục';
  } else {
    $('outputLabel').textContent = 'File đầu ra';
    $('outputName').textContent = state.outputPath ? fileName(state.outputPath) : 'Chọn nơi lưu';
  }
}

function resetOutput() {
  state.outputPath = null;
  $('resultBox').hidden = true;
  syncOutputUi();
}

function resetBenchmarkSession({ keepOutputRoot = true } = {}) {
  const outputRoot = keepOutputRoot ? state.benchmark.outputRoot : null;
  state.benchmark = {
    outputRoot,
    sessionDirectory: null,
    referencePath: null,
    results: [],
    items: []
  };
  $('referenceName').textContent = 'Chọn ảnh Photoshop';
  $('clearReferenceBtn').disabled = true;
  $('benchmarkSummaryCard').hidden = true;
  $('benchmarkResultList').replaceChildren();
  $('benchmarkBeforeSelect').replaceChildren();
  $('benchmarkAfterSelect').replaceChildren();
  syncOutputUi();
}

function showSourceOnly() {
  $('compareStage').hidden = true;
  $('compareControls').hidden = true;
  $('sourceStage').hidden = !state.inputPath;
}

function showComparisonUrls(beforeUrl, afterUrl) {
  if (!beforeUrl || !afterUrl) return;
  $('beforeImage').src = beforeUrl;
  $('afterImage').src = afterUrl;
  $('sourceStage').hidden = true;
  $('compareStage').hidden = false;
  $('compareControls').hidden = false;
  $('compareSlider').value = '50';
  updateCompare(50);
}

async function showComparison(outputPath) {
  if (state.tool === 'vector-logo') return;
  state.resultUrl = await window.studio.fileUrl(outputPath);
  showComparisonUrls(state.sourceUrl, `${state.resultUrl}?t=${Date.now()}`);
}

function updateCompare(value) {
  const percent = Math.max(0, Math.min(100, Number(value)));
  $('afterClip').style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
  $('compareDivider').style.left = `${percent}%`;
}

function renderInspector(metadata) {
  const sizeAt300 = metadata.printSizes?.[300];
  $('pixelInfo').textContent = `${metadata.width} × ${metadata.height} px`;
  $('printInfo').textContent = sizeAt300 ? `${sizeAt300.widthCm} × ${sizeAt300.heightCm} cm` : '—';
  $('formatInfo').textContent = `${String(metadata.format || '').toUpperCase()} · ${metadata.colorSpace || '—'}`;
  $('sizeInfo').textContent = formatBytes(metadata.sizeBytes);
  $('inspectorCard').hidden = false;
}

async function setInput(inputPath) {
  if (!inputPath) return;
  state.inputPath = inputPath;
  state.sourceUrl = await window.studio.fileUrl(inputPath);
  resetOutput();
  resetBenchmarkSession({ keepOutputRoot: true });

  $('inputName').textContent = fileName(inputPath);
  $('previewImage').src = state.sourceUrl;
  $('emptyState').hidden = true;
  $('sourceStage').hidden = false;
  $('compareStage').hidden = true;
  $('compareControls').hidden = true;
  $('runBtn').disabled = false;

  try {
    renderInspector(await window.studio.inspectImage(inputPath));
  } catch {
    $('inspectorCard').hidden = true;
  }
}

async function chooseInput() {
  await setInput(await window.studio.selectInput());
}

function updateProviderModels() {
  const provider = $('jobProviderSelect').value;
  const select = $('aiModelSelect');
  select.replaceChildren();
  for (const [value, label] of providerModels[provider] || providerModels.gemini) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  $('aiSizeSetting').hidden = provider === 'openai';
}

function selectTool(tool) {
  state.tool = tool;
  const [title, description] = toolInfo[tool];
  $('toolTitle').textContent = title;
  $('toolDescription').textContent = description;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));

  $('upscaleSettings').hidden = tool !== 'upscale';
  $('aiEnhanceSettings').hidden = tool !== 'ai-enhance';
  $('restoreSettings').hidden = tool !== 'restore';
  $('textSettings').hidden = tool !== 'text-print';
  $('vectorSettings').hidden = tool !== 'vector-logo';
  $('benchmarkSettings').hidden = tool !== 'model-lab';

  $('scaleSetting').hidden = ['ai-enhance', 'vector-logo'].includes(tool);
  $('dpiSetting').hidden = tool === 'vector-logo';
  $('formatSetting').hidden = ['vector-logo', 'model-lab'].includes(tool);

  const isCloud = tool === 'ai-enhance';
  const isLab = tool === 'model-lab';
  $('privacyBadge').textContent = isCloud
    ? 'Ảnh được gửi tới AI Cloud'
    : isLab
      ? 'Model Lab · xử lý local'
      : 'Ảnh không rời khỏi máy';
  $('privacyBadge').classList.toggle('cloud', isCloud);
  $('privacyBadge').classList.toggle('lab', isLab);
  $('runBtn').textContent = isCloud
    ? 'Tăng cường bằng AI'
    : tool === 'vector-logo'
      ? 'Tạo SVG vector'
      : isLab
        ? 'Chạy Model Lab'
        : 'Xử lý ảnh';

  if (isCloud && state.aiSettings) {
    $('jobProviderSelect').value = state.aiSettings.provider || 'gemini';
    updateProviderModels();
  }

  if (!isLab) state.outputPath = null;
  $('benchmarkSummaryCard').hidden = !(isLab && state.benchmark.results.length);
  syncOutputUi();
  $('resultBox').hidden = true;
  showSourceOnly();
}

async function chooseOutput() {
  if (!state.inputPath) return;

  if (state.tool === 'model-lab') {
    const directory = await window.studio.selectBenchmarkOutputDirectory();
    if (directory) {
      state.benchmark.outputRoot = directory;
      syncOutputUi();
    }
    return;
  }

  const outputPath = await window.studio.selectOutput({
    inputPath: state.inputPath,
    operation: state.tool,
    format: $('formatSelect').value
  });
  if (outputPath) {
    state.outputPath = outputPath;
    syncOutputUi();
  }
}

async function chooseReference() {
  const referencePath = await window.studio.selectReference();
  if (!referencePath) return;
  state.benchmark.referencePath = referencePath;
  $('referenceName').textContent = fileName(referencePath);
  $('clearReferenceBtn').disabled = false;
}

function clearReference() {
  state.benchmark.referencePath = null;
  $('referenceName').textContent = 'Chọn ảnh Photoshop';
  $('clearReferenceBtn').disabled = true;
}

function commonRasterOptions() {
  return {
    dpi: Number($('dpiSelect').value),
    quality: 95
  };
}

function optionsForTool() {
  const common = commonRasterOptions();
  if (state.tool === 'upscale') {
    return {
      ...common,
      scale: Number($('scaleSelect').value),
      model: $('modelSelect').value,
      useNcnn: true,
      allowFallback: true,
      sharpen: true
    };
  }
  if (state.tool === 'ai-enhance') {
    return {
      ...common,
      provider: $('jobProviderSelect').value,
      model: $('aiModelSelect').value,
      mode: selectedAiMode(),
      imageSize: $('aiImageSize').value,
      protectFace: $('protectFace').checked,
      protectText: $('protectText').checked,
      protectLogo: $('protectLogo').checked,
      preserveColor: $('preserveColor').checked,
      customPrompt: $('customPrompt').value,
      finishSharpen: true
    };
  }
  if (state.tool === 'restore') {
    return {
      ...common,
      scale: Number($('scaleSelect').value),
      denoise: Number($('denoise').value),
      saturation: Number($('saturation').value),
      contrast: Number($('contrast').value)
    };
  }
  if (state.tool === 'vector-logo') {
    return {
      colorMode: $('colorMode').value,
      threshold: Number($('threshold').value),
      turdSize: Number($('turdSize').value),
      invert: $('invertVector').checked,
      colorPrecision: 6,
      layerDifference: 5
    };
  }
  return {
    ...common,
    scale: Number($('scaleSelect').value),
    edge: Number($('edge').value)
  };
}

function selectedBenchmarkPresetIds() {
  return [...document.querySelectorAll('.benchmark-preset:checked:not(:disabled)')].map((input) => input.value);
}

async function ensureAiConfigured() {
  const settings = await window.studio.getAiSettings();
  renderAiSettings(settings);
  const provider = $('jobProviderSelect').value;
  const configured = provider === 'gemini' ? settings.gemini?.configured : settings.openai?.configured;
  if (!configured) {
    await openSettings();
    throw new Error(`Chưa có API key ${provider === 'gemini' ? 'Gemini' : 'OpenAI'}.`);
  }
}

async function benchmarkItem(label, pathValue, id) {
  return {
    id,
    label,
    path: pathValue,
    url: pathValue ? `${await window.studio.fileUrl(pathValue)}?t=${Date.now()}` : null
  };
}

async function renderBenchmarkResults(runResult) {
  const items = [await benchmarkItem('Ảnh gốc', state.inputPath, 'source')];
  if (state.benchmark.referencePath) {
    items.push(await benchmarkItem('Photoshop Reference', state.benchmark.referencePath, 'reference'));
  }

  for (const result of runResult.results.filter((entry) => entry.outputPath && !entry.error)) {
    items.push(await benchmarkItem(result.label, result.outputPath, result.id));
  }
  state.benchmark.items = items;

  const beforeSelect = $('benchmarkBeforeSelect');
  const afterSelect = $('benchmarkAfterSelect');
  beforeSelect.replaceChildren();
  afterSelect.replaceChildren();
  for (const item of items) {
    for (const select of [beforeSelect, afterSelect]) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      select.append(option);
    }
  }

  beforeSelect.value = items.some((item) => item.id === 'reference') ? 'reference' : 'source';
  const preferredAfter = ['official-fidelity', 'packaging-hybrid', 'official-detail', 'current-packaging']
    .find((id) => items.some((item) => item.id === id));
  afterSelect.value = preferredAfter || items.find((item) => item.id !== beforeSelect.value)?.id || beforeSelect.value;

  const resultList = $('benchmarkResultList');
  resultList.replaceChildren();
  for (const result of runResult.results) {
    const row = document.createElement('div');
    row.className = `benchmark-result-row${result.error ? ' error' : ''}`;
    if (!result.error) row.dataset.itemId = result.id;

    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = result.label;
    const detail = document.createElement('small');
    detail.textContent = result.error
      ? result.error
      : `${result.metadata?.width || '—'} × ${result.metadata?.height || '—'} px · ${formatBytes(result.metadata?.sizeBytes)}`;
    info.append(title, detail);

    const time = document.createElement('time');
    time.textContent = formatDuration(result.durationMs);
    row.append(info, time);
    resultList.append(row);
  }

  $('benchmarkFolderName').textContent = runResult.outputDirectory;
  $('benchmarkSummaryCard').hidden = false;
  await updateBenchmarkComparison();
}

async function updateBenchmarkComparison() {
  const beforeId = $('benchmarkBeforeSelect').value;
  const afterId = $('benchmarkAfterSelect').value;
  const before = state.benchmark.items.find((item) => item.id === beforeId);
  const after = state.benchmark.items.find((item) => item.id === afterId);
  if (!before?.url || !after?.url) return;
  showComparisonUrls(before.url, after.url);
}

async function runBenchmarkLab() {
  if (!state.benchmark.outputRoot) await chooseOutput();
  if (!state.benchmark.outputRoot) return;

  const presetIds = selectedBenchmarkPresetIds();
  if (!presetIds.length) throw new Error('Chọn ít nhất một model trong Model Lab.');

  const result = await window.studio.runBenchmark({
    inputPath: state.inputPath,
    outputDirectory: state.benchmark.outputRoot,
    referencePath: state.benchmark.referencePath,
    presetIds,
    scale: Number($('scaleSelect').value),
    dpi: Number($('dpiSelect').value),
    blendStrength: Number($('blendStrength').value) / 100
  });

  state.benchmark.sessionDirectory = result.outputDirectory;
  state.benchmark.results = result.results;
  await renderBenchmarkResults(result);

  const successCount = result.results.filter((entry) => !entry.error && entry.outputPath).length;
  const errorCount = result.results.length - successCount;
  $('resultBox').classList.toggle('error', successCount === 0);
  $('resultBox').textContent = errorCount
    ? `Model Lab hoàn tất ${successCount}/${result.results.length} kết quả. Có ${errorCount} model lỗi. Đã lưu tại: ${result.outputDirectory}`
    : `Model Lab hoàn tất ${successCount} kết quả. Đã lưu tại: ${result.outputDirectory}`;
  $('resultBox').hidden = false;
}

async function run() {
  if (state.busy || !state.inputPath) return;

  try {
    if (state.tool === 'ai-enhance') await ensureAiConfigured();

    if (state.tool !== 'model-lab') {
      if (!state.outputPath) await chooseOutput();
      if (!state.outputPath) return;
    }

    state.busy = true;
    $('runBtn').disabled = true;
    $('progressWrap').hidden = false;
    $('resultBox').hidden = true;
    $('progressBar').style.width = '1%';
    $('progressText').textContent = 'Đang chuẩn bị...';

    if (state.tool === 'model-lab') {
      await runBenchmarkLab();
      return;
    }

    const result = await window.studio.process({
      operation: state.tool,
      inputPath: state.inputPath,
      outputPath: state.outputPath,
      options: optionsForTool()
    });

    $('resultBox').classList.remove('error');
    $('resultBox').textContent = `Đã lưu: ${result.outputPath}`;
    $('resultBox').hidden = false;
    await showComparison(result.outputPath);
  } catch (error) {
    $('resultBox').classList.add('error');
    $('resultBox').textContent = error.message || String(error);
    $('resultBox').hidden = false;
  } finally {
    state.busy = false;
    $('runBtn').disabled = !state.inputPath;
  }
}

async function refreshEngine(statusPromise) {
  const status = await statusPromise;
  state.engine = status;
  const ready = status.configured && status.availableModels.length > 0;
  const labReady = ['realesrnet-x4plus', 'realesrgan-x4plus'].every((model) => status.availableModels.includes(model));
  $('engineDot').classList.toggle('online', ready);
  $('engineStatus').textContent = ready
    ? labReady
      ? 'Sẵn sàng · gồm model Model Lab.'
      : 'Sẵn sàng xử lý local. Model Lab Pro chưa đủ.'
    : 'Chế độ tương thích đang khả dụng.';

  [...$('modelSelect').options].forEach((option) => {
    option.disabled = status.configured && !status.availableModels.includes(option.value);
  });

  document.querySelectorAll('.benchmark-preset').forEach((input) => {
    const requiredModels = String(input.dataset.models || '').split(',').filter(Boolean);
    const available = requiredModels.every((model) => status.availableModels.includes(model));
    input.disabled = status.configured && !available;
    input.closest('.benchmark-option')?.setAttribute('title', available ? '' : `Thiếu model: ${requiredModels.filter((model) => !status.availableModels.includes(model)).join(', ')}`);
  });
}

function setAiSettingsMessage(message, isError = false) {
  const element = $('aiSettingsMessage');
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.hidden = !message;
}

function renderAiSettings(settings) {
  state.aiSettings = settings;
  $('aiProviderSelect').value = settings.provider || 'gemini';
  if (state.tool === 'ai-enhance') {
    $('jobProviderSelect').value = settings.provider || 'gemini';
    updateProviderModels();
  }

  const geminiSuffix = settings.gemini?.suffix;
  const openAiSuffix = settings.openai?.suffix;
  $('geminiKeyStatus').textContent = settings.gemini?.configured
    ? `Đã lưu an toàn · kết thúc bằng ${geminiSuffix}`
    : 'Chưa lưu API key';
  $('openAiKeyStatus').textContent = settings.openai?.configured
    ? `Đã lưu an toàn · kết thúc bằng ${openAiSuffix}`
    : 'Chưa lưu API key';

  $('clearGeminiKeyBtn').disabled = !settings.gemini?.configured;
  $('clearOpenAiKeyBtn').disabled = !settings.openai?.configured;
  $('testGeminiKeyBtn').disabled = !settings.gemini?.configured;
  $('testOpenAiKeyBtn').disabled = !settings.openai?.configured;
  $('saveSettingsBtn').disabled = settings.secureStorageAvailable === false;

  if (settings.secureStorageAvailable === false) {
    setAiSettingsMessage(settings.error || 'Bộ lưu trữ bảo mật của hệ điều hành chưa sẵn sàng.', true);
  }
}

async function loadAiSettings() {
  setAiSettingsMessage('');
  try {
    renderAiSettings(await window.studio.getAiSettings());
  } catch (error) {
    setAiSettingsMessage(error.message || String(error), true);
  }
}

async function openSettings() {
  $('settingsModal').hidden = false;
  $('geminiApiKeyInput').value = '';
  $('openAiApiKeyInput').value = '';
  await loadAiSettings();
  $('aiProviderSelect').focus();
}

function closeSettings() {
  $('settingsModal').hidden = true;
  $('geminiApiKeyInput').value = '';
  $('openAiApiKeyInput').value = '';
  setAiSettingsMessage('');
}

async function saveAiSettings(showSuccess = true) {
  const button = $('saveSettingsBtn');
  button.disabled = true;
  setAiSettingsMessage('Đang lưu...');

  try {
    const settings = await window.studio.saveAiSettings({
      provider: $('aiProviderSelect').value,
      geminiApiKey: $('geminiApiKeyInput').value,
      openAiApiKey: $('openAiApiKeyInput').value
    });
    $('geminiApiKeyInput').value = '';
    $('openAiApiKeyInput').value = '';
    renderAiSettings(settings);
    if (showSuccess) setAiSettingsMessage('Đã lưu cài đặt AI an toàn trên thiết bị.');
    return settings;
  } catch (error) {
    setAiSettingsMessage(error.message || String(error), true);
    throw error;
  } finally {
    button.disabled = state.aiSettings?.secureStorageAvailable === false;
  }
}

async function testAiConnection(provider) {
  const pendingKey = provider === 'gemini' ? $('geminiApiKeyInput').value.trim() : $('openAiApiKeyInput').value.trim();
  try {
    if (pendingKey) await saveAiSettings(false);
    setAiSettingsMessage(`Đang kiểm tra kết nối ${provider === 'gemini' ? 'Gemini' : 'OpenAI'}...`);
    await window.studio.testAiConnection(provider);
    setAiSettingsMessage(`Kết nối ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} thành công.`);
  } catch (error) {
    setAiSettingsMessage(error.message || String(error), true);
  }
}

async function clearAiKey(provider) {
  const providerName = provider === 'gemini' ? 'Gemini' : 'OpenAI';
  if (!window.confirm(`Xóa API key ${providerName} đã lưu trên máy này?`)) return;

  setAiSettingsMessage('Đang xóa...');
  try {
    renderAiSettings(await window.studio.clearAiKey(provider));
    setAiSettingsMessage(`Đã xóa API key ${providerName}.`);
  } catch (error) {
    setAiSettingsMessage(error.message || String(error), true);
  }
}

function bindRange(id, outputId, formatter = (value) => value) {
  const input = $(id);
  const output = $(outputId);
  input.addEventListener('input', () => { output.textContent = formatter(input.value); });
}

$('chooseInputBtn').addEventListener('click', chooseInput);
$('changeInputBtn').addEventListener('click', chooseInput);
$('chooseOutputBtn').addEventListener('click', chooseOutput);
$('chooseReferenceBtn').addEventListener('click', chooseReference);
$('clearReferenceBtn').addEventListener('click', clearReference);
$('runBtn').addEventListener('click', run);
$('showSourceBtn').addEventListener('click', showSourceOnly);
$('compareSlider').addEventListener('input', (event) => updateCompare(event.target.value));
$('formatSelect').addEventListener('change', resetOutput);
$('jobProviderSelect').addEventListener('change', updateProviderModels);
$('benchmarkBeforeSelect').addEventListener('change', updateBenchmarkComparison);
$('benchmarkAfterSelect').addEventListener('change', updateBenchmarkComparison);
$('benchmarkResultList').addEventListener('click', (event) => {
  const row = event.target.closest('[data-item-id]');
  if (!row) return;
  $('benchmarkAfterSelect').value = row.dataset.itemId;
  updateBenchmarkComparison();
});

$('toolNav').addEventListener('click', (event) => {
  const button = event.target.closest('.nav-item');
  if (button) selectTool(button.dataset.tool);
});

$('autoDetectBtn').addEventListener('click', () => refreshEngine(window.studio.autoDetectEngine()));
$('engineSetupBtn').addEventListener('click', () => refreshEngine(window.studio.selectEngineBinary()));
$('modelsSetupBtn').addEventListener('click', () => refreshEngine(window.studio.selectModelsDirectory()));
$('appSettingsBtn').addEventListener('click', openSettings);
$('closeSettingsBtn').addEventListener('click', closeSettings);
$('cancelSettingsBtn').addEventListener('click', closeSettings);
$('saveSettingsBtn').addEventListener('click', () => saveAiSettings(true));
$('testGeminiKeyBtn').addEventListener('click', () => testAiConnection('gemini'));
$('testOpenAiKeyBtn').addEventListener('click', () => testAiConnection('openai'));
$('clearGeminiKeyBtn').addEventListener('click', () => clearAiKey('gemini'));
$('clearOpenAiKeyBtn').addEventListener('click', () => clearAiKey('openai'));
$('settingsModal').addEventListener('click', (event) => {
  if (event.target === $('settingsModal')) closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('settingsModal').hidden) closeSettings();
});

const dropZone = $('dropZone');
['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('drag');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag');
}));
dropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) {
    const droppedPath = window.studio.getDroppedFilePath(file);
    if (droppedPath) setInput(droppedPath);
  }
});

window.studio.onProgress(({ percent, message }) => {
  $('progressWrap').hidden = false;
  $('progressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  $('progressText').textContent = message || `Đang xử lý ${percent}%`;
});

bindRange('denoise', 'denoiseValue');
bindRange('saturation', 'saturationValue');
bindRange('contrast', 'contrastValue');
bindRange('threshold', 'thresholdValue');
bindRange('turdSize', 'turdValue');
bindRange('edge', 'edgeValue');
bindRange('blendStrength', 'blendStrengthValue', (value) => `${value}%`);
updateProviderModels();
loadAiSettings();
refreshEngine(window.studio.getEngineStatus());
selectTool('upscale');
