const state = {
  tool: 'upscale',
  inputPath: null,
  outputPath: null,
  busy: false,
  engine: null,
  aiSettings: null
};

const toolInfo = {
  upscale: ['AI Upscale', 'Phóng lớn ảnh bằng backend Upscayl NCNN hoặc Lanczos dự phòng.'],
  restore: ['Restore Safe', 'Phục hồi ảnh nhẹ theo hướng bảo toàn, không sinh chi tiết giả.'],
  'vector-logo': ['Vector Logo', 'Chuyển logo màu, con dấu hoặc line art thành SVG vector.'],
  'text-print': ['Text Print Safe', 'Làm nét vùng chữ raster mà không OCR hoặc thay font.']
};

const $ = (id) => document.getElementById(id);
const fileName = (value) => value ? value.replaceAll('\\', '/').split('/').pop() : '';

async function setInput(inputPath) {
  if (!inputPath) return;
  state.inputPath = inputPath;
  state.outputPath = null;
  $('inputName').textContent = fileName(inputPath);
  $('outputName').textContent = 'Chọn nơi lưu';
  $('previewImage').src = await window.studio.fileUrl(inputPath);
  $('previewImage').hidden = false;
  $('emptyState').hidden = true;
  $('runBtn').disabled = false;
  $('resultBox').hidden = true;
}

async function chooseInput() {
  await setInput(await window.studio.selectInput());
}

function selectTool(tool) {
  state.tool = tool;
  const [title, description] = toolInfo[tool];
  $('toolTitle').textContent = title;
  $('toolDescription').textContent = description;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  $('upscaleSettings').hidden = tool !== 'upscale';
  $('restoreSettings').hidden = tool !== 'restore';
  $('vectorSettings').hidden = tool !== 'vector-logo';
  $('textSettings').hidden = tool !== 'text-print';
  state.outputPath = null;
  $('outputName').textContent = 'Chọn nơi lưu';
  $('resultBox').hidden = true;
}

async function chooseOutput() {
  if (!state.inputPath) return;
  const outputPath = await window.studio.selectOutput({ inputPath: state.inputPath, operation: state.tool });
  if (outputPath) {
    state.outputPath = outputPath;
    $('outputName').textContent = fileName(outputPath);
  }
}

function optionsForTool() {
  const common = { scale: Number($('scaleSelect').value) };
  if (state.tool === 'upscale') {
    return {
      ...common,
      model: $('modelSelect').value,
      useNcnn: $('useNcnn').checked,
      allowFallback: $('allowFallback').checked,
      sharpen: true
    };
  }
  if (state.tool === 'restore') {
    return { ...common, denoise: Number($('denoise').value), saturation: Number($('saturation').value), contrast: Number($('contrast').value) };
  }
  if (state.tool === 'vector-logo') {
    return { colorMode: $('colorMode').value, threshold: Number($('threshold').value), turdSize: Number($('turdSize').value), invert: $('invertVector').checked, colorPrecision: 6, layerDifference: 5 };
  }
  return { ...common, edge: Number($('edge').value) };
}

async function run() {
  if (state.busy || !state.inputPath) return;
  if (!state.outputPath) await chooseOutput();
  if (!state.outputPath) return;

  state.busy = true;
  $('runBtn').disabled = true;
  $('progressWrap').hidden = false;
  $('resultBox').hidden = true;
  $('progressBar').style.width = '1%';
  $('progressText').textContent = 'Đang chuẩn bị...';

  try {
    const result = await window.studio.process({
      operation: state.tool,
      inputPath: state.inputPath,
      outputPath: state.outputPath,
      options: optionsForTool()
    });
    $('resultBox').classList.remove('error');
    $('resultBox').textContent = `Đã lưu: ${result.outputPath}`;
    $('resultBox').hidden = false;
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
  $('engineDot').classList.toggle('online', status.configured && status.availableModels.length > 0);
  $('engineStatus').textContent = status.configured
    ? `${status.availableModels.length}/${status.expectedModels.length} model sẵn sàng.`
    : 'Chưa cấu hình. Có thể dùng fallback không-AI.';
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

async function saveAiSettings() {
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
    setAiSettingsMessage('Đã lưu cài đặt AI an toàn trên thiết bị.');
  } catch (error) {
    setAiSettingsMessage(error.message || String(error), true);
  } finally {
    button.disabled = state.aiSettings?.secureStorageAvailable === false;
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
$('saveSettingsBtn').addEventListener('click', saveAiSettings);
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
refreshEngine(window.studio.getEngineStatus());
