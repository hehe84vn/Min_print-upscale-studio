const state = {
  tool: 'upscale',
  inputPath: null,
  outputPath: null,
  busy: false,
  engine: null,
  aiSettings: null,
  sourceUrl: null,
  resultUrl: null
};

const toolInfo = {
  upscale: ['Local Enhance', 'Tăng kích thước và độ nét bằng bộ xử lý AI trên thiết bị.'],
  'ai-enhance': ['AI Enhance', 'Tái tạo chi tiết bằng Gemini hoặc OpenAI với mức kiểm soát phù hợp.'],
  restore: ['Restore Safe', 'Phục hồi ảnh nhẹ theo hướng bảo toàn, không sinh chi tiết giả.'],
  'text-print': ['Text & Artwork', 'Làm nét chữ và artwork raster mà không OCR hoặc thay font.'],
  'vector-logo': ['Vector Logo', 'Chuyển logo màu, con dấu hoặc line art thành SVG vector.']
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

function selectedAiMode() {
  return document.querySelector('input[name="aiMode"]:checked')?.value || 'safe';
}

function resetOutput() {
  state.outputPath = null;
  $('outputName').textContent = 'Chọn nơi lưu';
  $('resultBox').hidden = true;
}

function showSourceOnly() {
  $('compareStage').hidden = true;
  $('compareControls').hidden = true;
  $('sourceStage').hidden = !state.inputPath;
}

async function showComparison(outputPath) {
  if (state.tool === 'vector-logo') return;
  state.resultUrl = await window.studio.fileUrl(outputPath);
  $('beforeImage').src = state.sourceUrl;
  $('afterImage').src = `${state.resultUrl}?t=${Date.now()}`;
  $('sourceStage').hidden = true;
  $('compareStage').hidden = false;
  $('compareControls').hidden = false;
  $('compareSlider').value = '50';
  updateCompare(50);
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

  $('scaleSetting').hidden = ['ai-enhance', 'vector-logo'].includes(tool);
  $('dpiSetting').hidden = tool === 'vector-logo';
  $('formatSetting').hidden = tool === 'vector-logo';

  const isCloud = tool === 'ai-enhance';
  $('privacyBadge').textContent = isCloud ? 'Ảnh được gửi tới AI Cloud' : 'Ảnh không rời khỏi máy';
  $('privacyBadge').classList.toggle('cloud', isCloud);
  $('runBtn').textContent = isCloud ? 'Tăng cường bằng AI' : tool === 'vector-logo' ? 'Tạo SVG vector' : 'Xử lý ảnh';

  if (isCloud && state.aiSettings) {
    $('jobProviderSelect').value = state.aiSettings.provider || 'gemini';
    updateProviderModels();
  }
  resetOutput();
  showSourceOnly();
}

async function chooseOutput() {
  if (!state.inputPath) return;
  const outputPath = await window.studio.selectOutput({
    inputPath: state.inputPath,
    operation: state.tool,
    format: $('formatSelect').value
  });
  if (outputPath) {
    state.outputPath = outputPath;
    $('outputName').textContent = fileName(outputPath);
  }
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

async function run() {
  if (state.busy || !state.inputPath) return;

  try {
    if (state.tool === 'ai-enhance') await ensureAiConfigured();
    if (!state.outputPath) await chooseOutput();
    if (!state.outputPath) return;

    state.busy = true;
    $('runBtn').disabled = true;
    $('progressWrap').hidden = false;
    $('resultBox').hidden = true;
    $('progressBar').style.width = '1%';
    $('progressText').textContent = 'Đang chuẩn bị...';

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
  $('engineDot').classList.toggle('online', ready);
  $('engineStatus').textContent = ready
    ? 'Sẵn sàng xử lý trên thiết bị.'
    : 'Chế độ tương thích đang khả dụng.';

  [...$('modelSelect').options].forEach((option) => {
    option.disabled = status.configured && !status.availableModels.includes(option.value);
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

function bindRange(id, outputId) {
  const input = $(id);
  const output = $(outputId);
  input.addEventListener('input', () => { output.textContent = input.value; });
}

$('chooseInputBtn').addEventListener('click', chooseInput);
$('changeInputBtn').addEventListener('click', chooseInput);
$('chooseOutputBtn').addEventListener('click', chooseOutput);
$('runBtn').addEventListener('click', run);
$('showSourceBtn').addEventListener('click', showSourceOnly);
$('compareSlider').addEventListener('input', (event) => updateCompare(event.target.value));
$('formatSelect').addEventListener('change', resetOutput);
$('jobProviderSelect').addEventListener('change', updateProviderModels);

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
updateProviderModels();
loadAiSettings();
refreshEngine(window.studio.getEngineStatus());
selectTool('upscale');
