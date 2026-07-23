(() => {
  'use strict';

  if (!window.studio?.getLicenseStatus || document.getElementById('licenseGate')) return;

  const style = document.createElement('style');
  style.textContent = `
    .license-gate{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:32px;background:rgba(9,11,15,.88);backdrop-filter:blur(16px)}
    .license-gate[hidden]{display:none}
    .license-panel{width:min(440px,calc(100vw - 40px));border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:28px;background:#171a20;box-shadow:0 28px 90px rgba(0,0,0,.55);color:#f5f7fb}
    .license-brand{display:flex;align-items:center;gap:14px;margin-bottom:22px}
    .license-brand-mark{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,#f4b64b,#d88824);color:#16120c;font-weight:900;letter-spacing:-.04em}
    .license-brand strong{display:block;font-size:18px}.license-brand span{display:block;margin-top:3px;color:#9ca5b4;font-size:12px}
    .license-panel h2{margin:0 0 8px;font-size:24px}.license-panel>p{margin:0 0 20px;color:#aeb6c3;line-height:1.55}
    .license-status-message{min-height:20px;margin:12px 0!important;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.05);color:#c8cfda!important;font-size:13px}
    .license-status-message.error{background:rgba(220,70,70,.12);color:#ffb5b5!important}
    .license-form{display:grid;gap:12px}.license-form[hidden]{display:none}
    .license-form label{display:grid;gap:6px;color:#c9d0db;font-size:12px;font-weight:700}
    .license-form input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:12px 13px;background:#0f1116;color:#fff;outline:none}
    .license-form input:focus{border-color:#e8a33a;box-shadow:0 0 0 3px rgba(232,163,58,.12)}
    .license-primary,.license-secondary,.license-danger{border:0;border-radius:11px;padding:11px 14px;font-weight:800;cursor:pointer}
    .license-primary{background:#e7a13a;color:#17110a}.license-primary:disabled{opacity:.55;cursor:wait}
    .license-secondary{background:rgba(255,255,255,.08);color:#eef1f6}.license-danger{background:rgba(222,71,71,.12);color:#ffadad}
    .license-help{margin-top:16px!important;color:#7f8999!important;font-size:12px!important}
    .license-checking{display:flex;align-items:center;gap:10px;margin:16px 0;color:#c9d0db}.license-checking[hidden]{display:none}
    .license-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.18);border-top-color:#e7a13a;border-radius:50%;animation:license-spin .8s linear infinite}
    @keyframes license-spin{to{transform:rotate(360deg)}}
    .license-account-pill{display:flex;align-items:center;gap:9px;max-width:250px;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:7px 11px;background:rgba(255,255,255,.045);color:#dbe1ea;font-size:12px}
    .license-account-pill[hidden]{display:none}.license-dot{width:8px;height:8px;border-radius:50%;background:#59c979;box-shadow:0 0 0 4px rgba(89,201,121,.1)}
    .license-account-pill.offline .license-dot{background:#e7a13a;box-shadow:0 0 0 4px rgba(231,161,58,.1)}
    .license-account-pill span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .license-settings-card{margin:16px 0;padding:16px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.035)}
    .license-settings-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.license-settings-head strong{display:block}.license-settings-head small{display:block;margin-top:4px;color:#929cac}
    .license-state-badge{border-radius:999px;padding:5px 8px;background:rgba(89,201,121,.12);color:#8ee0a5;font-size:11px;font-weight:800}.license-state-badge.offline{background:rgba(231,161,58,.12);color:#f0bd6d}
    .license-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.license-meta div{padding:10px;border-radius:10px;background:rgba(0,0,0,.16)}.license-meta small{display:block;color:#8993a2;font-size:10px;text-transform:uppercase}.license-meta span{display:block;margin-top:4px;color:#e7ebf1;font-size:12px}
    .license-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.license-actions button{font-size:12px}
  `;
  document.head.append(style);

  const gate = document.createElement('div');
  gate.id = 'licenseGate';
  gate.className = 'license-gate';
  gate.innerHTML = `
    <section class="license-panel" role="dialog" aria-modal="true" aria-labelledby="licenseTitle">
      <div class="license-brand"><div class="license-brand-mark">PU</div><div><strong>Print Upscale Studio</strong><span>License bảo vệ theo tài khoản và thiết bị</span></div></div>
      <h2 id="licenseTitle">Đăng nhập để sử dụng</h2>
      <p>Tài khoản phải được quản trị viên cấp license trước khi kích hoạt thiết bị này.</p>
      <div id="licenseChecking" class="license-checking"><span class="license-spinner"></span><span>Đang xác minh quyền sử dụng...</span></div>
      <p id="licenseGateMessage" class="license-status-message">Đang kết nối máy chủ license.</p>
      <form id="licenseLoginForm" class="license-form" hidden>
        <label>Email<input id="licenseEmail" type="email" autocomplete="username" required /></label>
        <label>Mật khẩu<input id="licensePassword" type="password" autocomplete="current-password" required /></label>
        <button id="licenseLoginBtn" class="license-primary" type="submit">Đăng nhập & kích hoạt</button>
      </form>
      <button id="licenseRetryBtn" class="license-secondary" type="button" hidden>Kiểm tra lại</button>
      <p class="license-help">Lần kích hoạt đầu tiên cần Internet. Sau đó app có thể hoạt động offline trong thời hạn license được cấp.</p>
    </section>`;
  document.body.append(gate);

  const accountPill = document.createElement('div');
  accountPill.id = 'licenseAccountPill';
  accountPill.className = 'license-account-pill';
  accountPill.hidden = true;
  accountPill.innerHTML = '<i class="license-dot"></i><span></span>';
  const privacyBadge = document.getElementById('privacyBadge');
  privacyBadge?.parentElement?.insertBefore(accountPill, privacyBadge);

  const settingsCard = document.createElement('section');
  settingsCard.id = 'licenseSettingsCard';
  settingsCard.className = 'license-settings-card';
  settingsCard.innerHTML = `
    <div class="license-settings-head"><div><strong>Tài khoản & License</strong><small id="licenseSettingsEmail">Chưa đăng nhập</small></div><span id="licenseStateBadge" class="license-state-badge">—</span></div>
    <div class="license-meta"><div><small>Gói</small><span id="licensePlan">—</span></div><div><small>Offline đến</small><span id="licenseValidUntil">—</span></div><div><small>Thiết bị</small><span id="licenseDevice">—</span></div><div><small>Trạng thái</small><span id="licenseStatusText">—</span></div></div>
    <div class="license-actions"><button id="licenseValidateBtn" class="license-secondary" type="button">Xác minh lại</button><button id="licenseLogoutBtn" class="license-secondary" type="button">Đăng xuất</button><button id="licenseDeactivateBtn" class="license-danger" type="button">Hủy thiết bị</button></div>`;
  document.querySelector('#settingsModal .modal-actions')?.before(settingsCard);

  const get = (id) => document.getElementById(id);
  let currentStatus = null;
  let pending = false;

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function stateLabel(status) {
    if (status.state === 'active_online') return 'Đang hoạt động';
    if (status.state === 'active_offline') return 'Offline';
    if (status.state === 'checking') return 'Đang kiểm tra';
    if (status.state === 'blocked') return 'Bị khóa';
    return 'Chưa đăng nhập';
  }

  function render(status) {
    currentStatus = status || {};
    const active = currentStatus.processingAllowed === true;
    const checking = currentStatus.state === 'checking';
    const offline = currentStatus.state === 'active_offline';

    gate.hidden = active;
    get('licenseChecking').hidden = !checking;
    get('licenseLoginForm').hidden = checking || active;
    get('licenseRetryBtn').hidden = checking || active;
    get('licenseGateMessage').textContent = currentStatus.message || 'Cần đăng nhập để tiếp tục.';
    get('licenseGateMessage').classList.toggle('error', !checking && !active);

    accountPill.hidden = !active;
    accountPill.classList.toggle('offline', offline);
    accountPill.querySelector('span').textContent = active
      ? `${currentStatus.email || 'Licensed user'} · ${offline ? 'Offline' : 'Online'}`
      : '';

    get('licenseSettingsEmail').textContent = currentStatus.email || 'Chưa đăng nhập';
    get('licensePlan').textContent = currentStatus.plan || '—';
    get('licenseValidUntil').textContent = formatDate(currentStatus.validUntil);
    get('licenseDevice').textContent = currentStatus.maxDevices ? `1 / ${currentStatus.maxDevices}` : '—';
    get('licenseStatusText').textContent = currentStatus.message || stateLabel(currentStatus);
    get('licenseStateBadge').textContent = stateLabel(currentStatus);
    get('licenseStateBadge').classList.toggle('offline', offline);
    get('licenseValidateBtn').disabled = !active || pending;
    get('licenseLogoutBtn').disabled = !currentStatus.email || pending;
    get('licenseDeactivateBtn').disabled = !currentStatus.email || pending;

    if (!active && !checking) setTimeout(() => get('licenseEmail')?.focus(), 50);
  }

  function setPending(value, message) {
    pending = value;
    get('licenseLoginBtn').disabled = value;
    get('licenseRetryBtn').disabled = value;
    get('licenseValidateBtn').disabled = value || currentStatus?.processingAllowed !== true;
    get('licenseLogoutBtn').disabled = value || !currentStatus?.email;
    get('licenseDeactivateBtn').disabled = value || !currentStatus?.email;
    if (message) {
      get('licenseGateMessage').textContent = message;
      get('licenseGateMessage').classList.remove('error');
    }
  }

  async function refreshStatus({ manual = false } = {}) {
    setPending(true, manual ? 'Đang xác minh lại license...' : 'Đang kiểm tra quyền sử dụng...');
    try {
      const status = manual ? await window.studio.validateLicense() : await window.studio.getLicenseStatus(true);
      render(status);
    } catch (error) {
      render({
        ...(currentStatus || {}),
        state: 'blocked',
        processingAllowed: false,
        message: error.message || String(error)
      });
    } finally {
      setPending(false);
    }
  }

  get('licenseLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    setPending(true, 'Đang đăng nhập và kích hoạt thiết bị...');
    try {
      const status = await window.studio.loginLicense({
        email: get('licenseEmail').value,
        password: get('licensePassword').value
      });
      get('licensePassword').value = '';
      render(status);
    } catch (error) {
      get('licensePassword').value = '';
      render({ state: 'signed_out', processingAllowed: false, message: error.message || String(error) });
    } finally {
      setPending(false);
    }
  });

  get('licenseRetryBtn').addEventListener('click', () => refreshStatus({ manual: false }));
  get('licenseValidateBtn').addEventListener('click', () => refreshStatus({ manual: true }));
  get('licenseLogoutBtn').addEventListener('click', async () => {
    if (!window.confirm('Đăng xuất khỏi tài khoản license trên máy này?')) return;
    setPending(true);
    try { render(await window.studio.logoutLicense()); } finally { setPending(false); }
  });
  get('licenseDeactivateBtn').addEventListener('click', async () => {
    if (!window.confirm('Hủy kích hoạt thiết bị này? Thao tác cần Internet và sẽ giải phóng một suất thiết bị.')) return;
    setPending(true);
    try {
      render(await window.studio.deactivateLicense());
    } catch (error) {
      render({ ...(currentStatus || {}), message: error.message || String(error) });
    } finally {
      setPending(false);
    }
  });

  window.studio.onLicenseStatus((status) => render(status));
  window.addEventListener('online', () => {
    if (currentStatus?.state === 'active_offline') refreshStatus({ manual: true });
  });

  refreshStatus();
})();
