# Desktop License Client V1

Print Upscale Studio uses an account-based license bound to an activated installation.

## Client trust boundary

The packaged app contains only public configuration:

- Supabase project URL;
- Supabase publishable key;
- RSA public key for offline entitlement verification.

The app never contains the Supabase service-role key or the RSA private signing key.

## Secure local state

Electron main process stores these values through `safeStorage`:

- Supabase access and refresh session;
- random installation identifier;
- P-256 device private key;
- signed offline entitlement.

Renderer code receives status summaries only. It never receives access tokens, refresh tokens, private keys or raw entitlement signatures.

## Device binding

Each installation creates a P-256 key pair. The Edge Function stores the public key and requires a timestamped ECDSA proof for activation, validation and deactivation. Copying a session file or installer to another machine is not sufficient to impersonate the activated installation.

## Offline entitlement

The Edge Function issues an RSA-PSS signed entitlement with:

- user ID and email;
- license and plan IDs;
- activated device ID;
- installation hash;
- maximum device count;
- issue and expiration timestamps.

The desktop app verifies the signature and installation hash before allowing offline processing.

## Protected processing routes

The Electron bootstrap blocks these IPC routes unless the license is currently valid:

- `image:process`;
- `production:start`;
- `benchmark:run`;
- `color:convert`.

File selection, metadata inspection and settings remain available so a blocked user can diagnose the problem without losing local work.

## User actions

- **Đăng xuất:** removes the local session and entitlement but keeps the activated device slot.
- **Hủy thiết bị:** revokes the current device online, clears local credentials and rotates the installation identity.
- **Xác minh lại:** refreshes the signed offline entitlement from Supabase.
