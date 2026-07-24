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
    .then(() => loadScript('model-studio-v15-ui.js'))
    .then(() => loadScript('cmyk-opt-in-v15-1.js'))
    .then(() => loadScript('model-studio-v15-suite-ui.js'))
    .then(() => loadScript('update-manager-v16-ui.js'))
    .then(() => loadScript('update-manager-v19-extension.js'))
    .then(() => loadScript('production-polish-v19-ui.js'))
    .then(() => loadScript('license-ui.js'))
    .catch((error) => console.error('Renderer extension loader:', error));
})();