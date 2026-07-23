begin;

create extension if not exists pgcrypto;

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  plan text not null default 'studio-standard',
  status text not null default 'active' check (status in ('active', 'suspended', 'expired', 'revoked')),
  expires_at timestamptz,
  max_devices integer not null default 1 check (max_devices between 1 and 20),
  offline_days integer not null default 7 check (offline_days between 0 and 30),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_licenses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  assigned_at timestamptz not null default now()
);

create table if not exists public.license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_hash text not null,
  device_public_key text not null,
  platform text not null check (platform in ('darwin', 'win32', 'linux')),
  architecture text,
  device_name text,
  app_version text,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  unique (license_id, installation_hash)
);

create table if not exists public.license_events (
  id bigint generated always as identity primary key,
  license_id uuid references public.licenses(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  device_id uuid references public.license_devices(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_licenses_license_id_idx on public.user_licenses(license_id);
create index if not exists license_devices_user_id_idx on public.license_devices(user_id);
create index if not exists license_devices_license_id_active_idx on public.license_devices(license_id) where revoked_at is null;
create index if not exists license_events_license_id_created_at_idx on public.license_events(license_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists licenses_set_updated_at on public.licenses;
create trigger licenses_set_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();

alter table public.licenses enable row level security;
alter table public.user_licenses enable row level security;
alter table public.license_devices enable row level security;
alter table public.license_events enable row level security;

revoke all on public.licenses from anon, authenticated;
revoke all on public.user_licenses from anon, authenticated;
revoke all on public.license_devices from anon, authenticated;
revoke all on public.license_events from anon, authenticated;

grant select on public.licenses to authenticated;
grant select on public.user_licenses to authenticated;
grant select on public.license_devices to authenticated;

create policy "users can read their assigned license"
on public.licenses
for select
to authenticated
using (
  exists (
    select 1
    from public.user_licenses ul
    where ul.license_id = licenses.id
      and ul.user_id = (select auth.uid())
  )
);

create policy "users can read their own license assignment"
on public.user_licenses
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users can read their own devices"
on public.license_devices
for select
to authenticated
using (user_id = (select auth.uid()));

comment on table public.licenses is 'Commercial entitlements for Print Upscale Studio. Writes are server/admin only.';
comment on table public.user_licenses is 'One active license assignment per Supabase Auth user.';
comment on table public.license_devices is 'Activated installations. Client cannot write directly; Edge Function controls activation and revocation.';
comment on table public.license_events is 'Append-only server-side audit trail for license operations.';

commit;
