(() => {
  'use strict';
  const isMac = navigator.platform.toLowerCase().includes('mac');
  if (!isMac) return;

  function syncMacDownloadButton() {
    const install = document.getElementById('installUpdateBtn');
    const status = document.getElementById('updateManagerV16Status');
    if (!install || !status) return;
    const hasUpdate = status.classList.contains('success') && /Có bản/i.test(status.textContent || '');
    if (hasUpdate) {
      install.hidden = false;
      install.textContent = 'Tải DMG';
      install.title = 'Tải file DMG về Downloads, sau đó tự mở và cài đè ứng dụng.';
    }
  }

  const observer = new MutationObserver(syncMacDownloadButton);
  const wait = window.setInterval(() => {
    const modal = document.getElementById('updateManagerV16Modal');
    if (!modal) return;
    window.clearInterval(wait);
    observer.observe(modal, { subtree: true, childList: true, attributes: true, characterData: true });
    syncMacDownloadButton();
  }, 100);
})();