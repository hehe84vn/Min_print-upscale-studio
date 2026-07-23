(() => {
  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`Không tải được ${source}`)), { once: true });
      document.body.append(script);
    });
  }

  loadScript('zoom-core.js')
    .then(() => loadScript('vector-smart-ui.js'))
    .then(() => loadScript('vector-node-preview-ui.js'))
    .then(() => loadScript('vector-cleanup-rerun-ui.js'))
    .then(() => loadScript('vector-auto-cleanup-ui.js'))
    .then(() => loadScript('vector-engine-comparison-ui.js'))
    .then(() => loadScript('version-ui.js'))
    .then(() => loadScript('navigation-structure-safe.js'))
    .then(() => loadScript('license-ui.js'))
    .catch((error) => console.error('Renderer extension loader:', error));
})();