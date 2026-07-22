(() => {
  const setVersion = () => {
    document.title = 'Print Upscale Studio V2.8 Smart Vector';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.8 · Smart Production + Vector';
  };

  setVersion();
  document.getElementById('toolNav')?.addEventListener('click', () => queueMicrotask(setVersion));
})();
