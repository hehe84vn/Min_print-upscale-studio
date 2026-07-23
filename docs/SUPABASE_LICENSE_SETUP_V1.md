# Supabase License Setup V1

This guide provisions the V1 licensing backend for Print Upscale Studio:

- account-based login;
- one license per user;
- configurable device limit;
- signed offline entitlement;
- default seven-day offline grace period;
- server-side activation, validation, revocation and audit events.

## Security boundary

The Electron app may contain only:

- Supabase project URL;
- Supabase publishable/anon key;
- RSA public key used to verify offline entitlements.

Never place these values in the app or repository:

- database password;
- `service_role`/secret key;
- RSA private signing key.

## 1. Create the project

Create a new Supabase project. Record:

- Project URL;
- Publishable key (or legacy anon key);
- Project reference ID.

Do not copy the service-role key into the desktop app.

## 2. Configure email/password authentication

In Authentication settings:

- enable Email provider;
- disable public sign-up for the first release;
- create users from Authentication > Users;
- use confirmed users so the first login is not blocked by email confirmation.

## 3. Create the license schema

Open SQL Editor, paste the complete contents of:

`supabase/migrations/202607230001_license_foundation.sql`

Run it once. Confirm these tables exist:

- `licenses`
- `user_licenses`
- `license_devices`
- `license_events`

RLS must remain enabled.

## 4. Generate the offline signing key pair

Run on a trusted Mac or Linux machine:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out license-private.pem
openssl pkcs8 -topk8 -inform PEM -outform DER -in license-private.pem -nocrypt | base64 | tr -d '\n' > license-private-pkcs8.b64
openssl pkey -in license-private.pem -pubout -out license-public.pem
```

Keep these files private:

- `license-private.pem`
- `license-private-pkcs8.b64`

The public file `license-public.pem` is safe to embed in the Electron app.

## 5. Configure Edge Function secret

In Edge Functions secrets, add:

- Name: `LICENSE_PRIVATE_KEY_PKCS8_B64`
- Value: complete single-line content of `license-private-pkcs8.b64`

Supabase automatically provides the function runtime with the project URL, anon key and service-role key. The service-role key stays server-side.

## 6. Deploy the Edge Function

Using Supabase CLI:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy license-gateway
```

The function requires a valid Supabase user JWT because `verify_jwt = true`.

## 7. Create the first user and license

Create the user in Authentication > Users and copy the user's UUID.

Run this in SQL Editor, replacing the email lookup if needed:

```sql
with new_license as (
  insert into public.licenses (
    plan,
    status,
    expires_at,
    max_devices,
    offline_days,
    notes
  )
  values (
    'studio-standard',
    'active',
    now() + interval '1 year',
    1,
    7,
    'First production license'
  )
  returning id
)
insert into public.user_licenses (user_id, license_id)
select
  (select id from auth.users where email = 'USER_EMAIL_HERE'),
  id
from new_license;
```

## 8. Revoke or reset a device

Revoke one device:

```sql
update public.license_devices
set
  revoked_at = now(),
  revoke_reason = 'admin_reset'
where id = 'DEVICE_UUID_HERE';
```

Reset all devices for one user:

```sql
update public.license_devices
set
  revoked_at = now(),
  revoke_reason = 'admin_reset_all'
where user_id = 'USER_UUID_HERE'
  and revoked_at is null;
```

The user can activate a replacement device after the old device is revoked.

## 9. Suspend a license

```sql
update public.licenses
set status = 'suspended'
where id = 'LICENSE_UUID_HERE';
```

Restore access:

```sql
update public.licenses
set status = 'active'
where id = 'LICENSE_UUID_HERE';
```

## 10. Client integration values

The Electron integration phase needs only:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
LICENSE_PUBLIC_KEY_PEM
```

Do not send or commit the service-role key or private signing key.

## 11. Recommended V1 policy

- one account;
- one active installation;
- seven offline days;
- validate at app launch when online;
- refresh entitlement before long batch jobs;
- block new processing after offline entitlement expiry;
- keep access to existing files and settings;
- admin reset required when changing machines repeatedly.
