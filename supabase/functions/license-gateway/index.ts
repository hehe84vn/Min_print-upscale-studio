import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LICENSE_PRIVATE_KEY_PKCS8_B64 = Deno.env.get('LICENSE_PRIVATE_KEY_PKCS8_B64') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type LicenseAction = 'activate' | 'validate' | 'deactivate'

type RequestBody = {
  action?: LicenseAction
  installationHash?: string
  devicePublicKey?: string
  platform?: 'darwin' | 'win32' | 'linux'
  architecture?: string
  deviceName?: string
  appVersion?: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s+/g, ''))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function signEntitlement(payload: Record<string, unknown>) {
  if (!LICENSE_PRIVATE_KEY_PKCS8_B64) {
    throw new Error('LICENSE_PRIVATE_KEY_PKCS8_B64 is not configured')
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodeBase64(LICENSE_PRIVATE_KEY_PKCS8_B64),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, encoded)
  return base64Url(new Uint8Array(signature))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json(401, { error: 'missing_access_token' })

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  const user = userData.user
  if (userError || !user) return json(401, { error: 'invalid_access_token' })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const action = body.action || 'validate'
  const installationHash = String(body.installationHash || '').trim()
  if (!installationHash || installationHash.length < 32 || installationHash.length > 256) {
    return json(400, { error: 'invalid_installation_hash' })
  }

  const { data: assignment, error: assignmentError } = await admin
    .from('user_licenses')
    .select('license_id, licenses(*)')
    .eq('user_id', user.id)
    .maybeSingle()

  if (assignmentError) return json(500, { error: 'license_lookup_failed' })
  const license = Array.isArray(assignment?.licenses) ? assignment?.licenses[0] : assignment?.licenses
  if (!assignment || !license) return json(403, { error: 'license_not_assigned' })

  const now = new Date()
  const expired = license.expires_at && new Date(license.expires_at).getTime() <= now.getTime()
  if (license.status !== 'active' || expired) {
    return json(403, { error: expired ? 'license_expired' : `license_${license.status}` })
  }

  let { data: device, error: deviceError } = await admin
    .from('license_devices')
    .select('*')
    .eq('license_id', license.id)
    .eq('installation_hash', installationHash)
    .maybeSingle()

  if (deviceError) return json(500, { error: 'device_lookup_failed' })

  if (action === 'deactivate') {
    if (device && !device.revoked_at) {
      const { error } = await admin
        .from('license_devices')
        .update({ revoked_at: now.toISOString(), revoke_reason: 'user_deactivated' })
        .eq('id', device.id)
      if (error) return json(500, { error: 'device_deactivation_failed' })
      await admin.from('license_events').insert({
        license_id: license.id,
        user_id: user.id,
        device_id: device.id,
        event_type: 'device_deactivated',
      })
    }
    return json(200, { ok: true })
  }

  if (device?.revoked_at) return json(403, { error: 'device_revoked' })

  if (!device) {
    if (action !== 'activate') return json(403, { error: 'device_not_activated' })
    if (!body.devicePublicKey || !body.platform) return json(400, { error: 'missing_device_registration' })

    const { count, error: countError } = await admin
      .from('license_devices')
      .select('id', { count: 'exact', head: true })
      .eq('license_id', license.id)
      .is('revoked_at', null)
    if (countError) return json(500, { error: 'device_count_failed' })
    if ((count || 0) >= license.max_devices) return json(409, { error: 'device_limit_reached' })

    const { data: inserted, error: insertError } = await admin
      .from('license_devices')
      .insert({
        license_id: license.id,
        user_id: user.id,
        installation_hash: installationHash,
        device_public_key: body.devicePublicKey,
        platform: body.platform,
        architecture: body.architecture || null,
        device_name: body.deviceName || null,
        app_version: body.appVersion || null,
      })
      .select('*')
      .single()
    if (insertError) return json(500, { error: 'device_activation_failed' })
    device = inserted

    await admin.from('license_events').insert({
      license_id: license.id,
      user_id: user.id,
      device_id: device.id,
      event_type: 'device_activated',
      details: { platform: body.platform, architecture: body.architecture, appVersion: body.appVersion },
    })
  } else {
    const { data: updated, error: updateError } = await admin
      .from('license_devices')
      .update({
        last_seen_at: now.toISOString(),
        app_version: body.appVersion || device.app_version,
        device_name: body.deviceName || device.device_name,
      })
      .eq('id', device.id)
      .select('*')
      .single()
    if (updateError) return json(500, { error: 'device_update_failed' })
    device = updated
  }

  const validUntil = new Date(now.getTime() + Number(license.offline_days || 0) * 86400000)
  if (license.expires_at && validUntil.getTime() > new Date(license.expires_at).getTime()) {
    validUntil.setTime(new Date(license.expires_at).getTime())
  }

  const entitlement = {
    version: 1,
    userId: user.id,
    email: user.email || null,
    licenseId: license.id,
    plan: license.plan,
    deviceId: device.id,
    installationHash,
    maxDevices: license.max_devices,
    issuedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
  }

  const signature = await signEntitlement(entitlement)
  await admin.from('license_events').insert({
    license_id: license.id,
    user_id: user.id,
    device_id: device.id,
    event_type: action === 'activate' ? 'entitlement_issued_after_activation' : 'entitlement_refreshed',
  })

  return json(200, { ok: true, entitlement, signature })
})
