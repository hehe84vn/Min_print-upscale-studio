(() => {
  const $ = (id) => document.getElementById(id);
  let latestResult = null;
  let checking = false;
  let installing = false;

  function installStyles() {
    if ($('updateManagerV16Styles')) return;
    const style = document.createElement('style');
    style.id = 'updateManagerV16Styles';
    style.textContent = `
      .update-check-button{margin-top:8px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px;min-height:34px;border:1px solid #33404c;border-radius:9px;background:#171d24;color:#cfd6df;font-size:10px;font-weight:750;cursor:pointer}
      .update-check-button:hover{border-color:var(--accent);color:var(--accent)}
      .update-check-button[disabled]{opacity:.55;cursor:wait}
      .update-v16-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(5,8,12,.72);display:grid;place-items:center;padding:24px}
      .update-v16-backdrop[hidden]{display:none}
      .update-v16-card{width:min(620px,94vw);max-height:82vh;overflow:auto;border:1px solid #405166;border-radius:15px;background:#11171f;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:18px;display:grid;gap:13px}
      .update-v16-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.update-v16-head h2{margin:3px 0 0;font-size:18px}.update-v16-kicker{font-size:8px;letter-spacing:.15em;color:#7f8b99;font-weight:850}
      .update-v16-close{border:0;background:transparent;color:#aab4c0;font-size:22px;cursor:pointer}
      .update-v16-version{display:grid;grid-template-columns:1fr 1fr;gap:8px}.update-v16-version div{padding:10px;border-radius:9px;background:#171e27}.update-v16-version small{display:block;color:#7e8997;font-size:8px}.update-v16-version strong{display:block;margin-top:4px;font-size:12px}
      .update-v16-notes{white-space:pre-wrap;line-height:1.55;font-size:10px;color:#bcc5d0;background:#0d131a;border-radius:9px;padding:11px;max-height:270px;overflow:auto}
      .update-v16-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.update-v16-actions button{padding:9px 12px;font-size:10px}
      .update-v16-status{font-size:10px;color:#92a0af;line-height:1.45}.update-v16-status.error{color:#ff9fa8}.update-v16-status.success{color:#9fd5aa}.update-v16-status.warning{color:#ffca7a}
      .update-v16-progress{height:7px;border-radius:999px;background:#202a35;overflow:hidden}.update-v16-progress[hidden]{display:none}.update-v16-progress span{display:block;width:0;height:100%;background:var(--accent);transition:width .18s ease}
    `;
    document.head.append(style);
  }

  function installButton() {
    const settingsButton = $('appSettingsBtn');
    if (!settingsButton || $('checkForUpdatesBtn')) return;
    const button = document.createElement('button');
    button.id = 'checkForUpdatesBtn';
    button.type = 'button';
    button.className = 'update-check-button';
    button.innerHTML = '<span>↻</span><span>Kiểm tra cập nhật</span>';
    settingsButton.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => checkForUpdates({ manual: true }));
  }

  function installModal() {
    if ($('updateManagerV16Modal')) return;
    const modal = document.createElement('div');
    modal.id = 'updateManagerV16Modal';
    modal.className = 'update-v16-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <section class="update-v16-card" role="dialog" aria-modal="true" aria-labelledby="updateManagerV16Title">
        <div class="update-v16-head"><div><div class="update-v16-kicker">UPDATE MANAGER V16</div><h2 id="updateManagerV16Title">Cập nhật Print Upscale Studio</h2></div><button id="closeUpdateManagerV16" class="update-v16-close" type="button" aria-label="Đóng">×</button></div>
        <div class="update-v16-version"><div><small>PHIÊN BẢN ĐANG DÙNG</small><strong id="updateCurrentVersion">—</strong></div><div><small>PHIÊN BẢN MỚI NHẤT</small><strong id="updateLatestVersion">—</strong></div></div>
        <div id="updateManagerV16Status" class="update-v16-status">Đang kiểm tra...</div>
        <div id="updateDownloadProgress" class="update-v16-progress" hidden><span></span></div>
        <div id="updateReleaseNotes" class="update-v16-notes" hidden></div>
        <div class="update-v16-actions"><button id="updateLaterBtn" class="secondary" type="button">Để sau</button><button id="openUpdateReleaseBtn" class="secondary" type="button" hidden>Mở GitHub Releases</button><button id="installUpdateBtn" class="primary" type="button" hidden>Tải và cài đặt</button></div>
      </section>`;
    document.body.append(modal);
    $('closeUpdateManagerV16').addEventListener('click', closeModal);
    $('updateLaterBtn').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => { if (event.target === modal && !installing) closeModal(); });
    $('openUpdateReleaseBtn').addEventListener('click', async () => {
      const url = latestResult?.releaseUrl || latestResult?.releasesUrl;
      await window.studio.openUpdateRelease(url);
    });
    $('installUpdateBtn').addEventListener('click', installLatestUpdate);
  }

  function closeModal() {
    if (!installing) $('updateManagerV16Modal').hidden = true;
  }

  function showModal() { $('updateManagerV16Modal').hidden = false; }

  function setStatus(message, type = '') {
    const status = $('updateManagerV16Status');
    status.className = `update-v16-status${type ? ` ${type}` : ''}`;
    status.textContent = message;
  }

  function isProductionBusy(status) {
    const value = String(status?.state || status?.status || '').toLowerCase();
    return status?.running === true || status?.active === true || ['running', 'processing', 'paused', 'stopping'].includes(value);
  }

  async function currentBusyState() {
    let productionBusy = false;
    try { productionBusy = isProductionBusy(await window.studio.getProductionStatus?.()); }
    catch { productionBusy = false; }
    return { busy: Boolean(typeof state !== 'undefined' && state.busy), productionBusy };
  }

  function renderResult(result, manual) {
    latestResult = result;
    $('updateCurrentVersion').textContent = result.currentVersion || '—';
    $('updateLatestVersion').textContent = result.latestVersion || 'Chưa có release';
    const notes = $('updateReleaseNotes');
    const openButton = $('openUpdateReleaseBtn');
    const installButton = $('installUpdateBtn');
    $('updateDownloadProgress').hidden = true;

    if (result.updateAvailable) {
      setStatus(result.asset
        ? `Có bản ${result.latestVersion}. Gói phù hợp: ${result.asset.name}.`
        : `Có bản ${result.latestVersion}. Release chưa có bộ cài phù hợp cho máy này.`, 'success');
      notes.hidden = !result.notes;
      notes.textContent = result.notes || '';
      openButton.hidden = false;
      installButton.hidden = !(result.platform === 'win32' && result.asset);
      installButton.textContent = 'Tải và cài đặt';
      openButton.textContent = result.platform === 'darwin' ? 'Mở GitHub Releases' : 'Mở trang tải bản mới';
      showModal();
      return;
    }

    setStatus(result.reason || `Bạn đang dùng phiên bản mới nhất (${result.currentVersion}).`);
    notes.hidden = true;
    openButton.hidden = true;
    installButton.hidden = true;
    if (manual) showModal();
  }

  async function installLatestUpdate() {
    if (installing || !latestResult?.updateAvailable) return;
    const blockers = await currentBusyState();
    if (blockers.busy || blockers.productionBusy) {
      setStatus('Đang có job xử lý. Hãy chờ hoàn tất hoặc hủy job trước khi cập nhật.', 'warning');
      return;
    }

    installing = true;
    $('installUpdateBtn').disabled = true;
    $('updateLaterBtn').disabled = true;
    $('closeUpdateManagerV16').disabled = true;
    $('updateDownloadProgress').hidden = false;
    setStatus('Đang chuẩn bị tải bộ cài...');
    try {
      await window.studio.installUpdate({
        busy: blockers.busy,
        productionBusy: blockers.productionBusy,
        releaseUrl: latestResult.releaseUrl
      });
    } catch (error) {
      installing = false;
      $('installUpdateBtn').disabled = false;
      $('updateLaterBtn').disabled = false;
      $('closeUpdateManagerV16').disabled = false;
      setStatus(error.message || String(error), 'error');
    }
  }

  async function checkForUpdates({ manual = false } = {}) {
    if (checking || !window.studio?.checkForUpdates) return;
    checking = true;
    const button = $('checkForUpdatesBtn');
    if (button) {
      button.disabled = true;
      button.lastElementChild.textContent = 'Đang kiểm tra...';
    }
    if (manual) {
      showModal();
      setStatus('Đang kết nối GitHub Releases...');
    }
    try {
      renderResult(await window.studio.checkForUpdates(), manual);
    } catch (error) {
      if (manual) {
        setStatus(error.message || String(error), 'error');
        $('updateReleaseNotes').hidden = true;
        $('openUpdateReleaseBtn').hidden = true;
        $('installUpdateBtn').hidden = true;
      } else {
        console.warn('Update check:', error);
      }
    } finally {
      checking = false;
      if (button) {
        button.disabled = false;
        button.lastElementChild.textContent = 'Kiểm tra cập nhật';
      }
    }
  }

  function installProgressListener() {
    if (!window.studio?.onUpdateProgress) return;
    window.studio.onUpdateProgress((progress = {}) => {
      showModal();
      const bar = $('updateDownloadProgress');
      bar.hidden = false;
      if (Number.isFinite(progress.percent)) bar.firstElementChild.style.width = `${Math.max(0, Math.min(100, progress.percent))}%`;
      setStatus(progress.message || 'Đang cập nhật...');
    });
  }

  installStyles();
  installButton();
  installModal();
  installProgressListener();
  window.setTimeout(() => checkForUpdates({ manual: false }), 7000);
})();