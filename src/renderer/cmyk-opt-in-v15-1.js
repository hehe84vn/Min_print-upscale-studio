(() => {
  const $ = (id) => document.getElementById(id);

  function installStyles() {
    if ($('cmykOptInV151Styles')) return;
    const style = document.createElement('style');
    style.id = 'cmykOptInV151Styles';
    style.textContent = `
      .cmyk-optin-card{margin:14px 0;padding:12px;border:1px solid #425477;border-radius:11px;background:#121923;display:grid;gap:10px}
      .cmyk-optin-card .check-row{margin:0}
      .cmyk-optin-details{display:grid;grid-template-columns:1fr;gap:8px}
      .cmyk-optin-details[hidden]{display:none}
      .cmyk-optin-note{margin:0;color:#8f9bad;font-size:10px;line-height:1.45}
    `;
    document.head.append(style);
  }

  function installJobCheckbox() {
    const legacyCard = $('colorOutputJobCard');
    const modeSelect = $('jobColorOutputMode');
    const profileSelect = $('jobColorProfile');
    if (!legacyCard || !modeSelect || !profileSelect || $('createCmykTiff')) return;

    legacyCard.hidden = true;
    modeSelect.value = 'rgb-only';

    const card = document.createElement('section');
    card.id = 'cmykOptInJobCard';
    card.className = 'cmyk-optin-card';
    card.innerHTML = `
      <label class="check-row"><input id="createCmykTiff" type="checkbox" /><span>Tạo thêm bản CMYK TIFF</span></label>
      <div id="cmykOptInDetails" class="cmyk-optin-details" hidden>
        <div class="setting-group">
          <label for="cmykOptInProfile">CMYK profile</label>
          <select id="cmykOptInProfile"></select>
        </div>
        <p class="cmyk-optin-note">RGB Master luôn được giữ. Chỉ khi bật tùy chọn này, app mới tạo thêm TIFF CMYK 8-bit, LZW và nhúng ICC.</p>
      </div>
    `;
    legacyCard.insertAdjacentElement('afterend', card);

    const optInProfile = $('cmykOptInProfile');
    optInProfile.innerHTML = profileSelect.innerHTML;
    optInProfile.value = profileSelect.value;

    const sync = () => {
      const enabled = $('createCmykTiff').checked;
      modeSelect.value = enabled ? 'rgb-cmyk' : 'rgb-only';
      $('cmykOptInDetails').hidden = !enabled;
      profileSelect.value = optInProfile.value;
    };

    $('createCmykTiff').addEventListener('change', sync);
    optInProfile.addEventListener('change', sync);
    profileSelect.addEventListener('change', () => {
      optInProfile.value = profileSelect.value;
    });
    sync();
  }

  function enforceRgbDefault() {
    const defaultMode = $('defaultColorOutputMode');
    if (!defaultMode) return;
    defaultMode.value = 'rgb-only';
    const group = defaultMode.closest('.setting-group');
    if (group) {
      group.hidden = true;
      group.setAttribute('aria-hidden', 'true');
    }
  }

  function syncVisibility() {
    const card = $('cmykOptInJobCard');
    if (!card || typeof state === 'undefined') return;
    card.hidden = ['vector-logo', 'model-lab'].includes(state.tool);
  }

  function installToolHook() {
    const originalSelectTool = window.selectTool;
    if (typeof originalSelectTool !== 'function' || window.__cmykOptInToolHook) return;
    window.__cmykOptInToolHook = true;
    window.selectTool = function selectToolWithCmykOptIn(tool) {
      originalSelectTool(tool);
      syncVisibility();
    };
  }

  installStyles();
  installJobCheckbox();
  enforceRgbDefault();
  installToolHook();
  syncVisibility();
})();
