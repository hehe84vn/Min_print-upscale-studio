(() => {
  const setVersion = () => {
    document.title = 'Print Upscale Studio V2.9.4';
    const brandVersion = document.querySelector('.brand span');
    if (brandVersion) brandVersion.textContent = 'Studio V2.9.4 · Tối ưu hình ảnh cho in ấn';
  };

  setVersion();
  document.getElementById('toolNav')?.addEventListener('click', () => queueMicrotask(setVersion));
})();
