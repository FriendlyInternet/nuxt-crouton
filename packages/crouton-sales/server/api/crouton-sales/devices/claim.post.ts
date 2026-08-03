/**
 * Claim a till device with a pairing code (#1662) — the device half of #803's
 * onboarding, and the app-mints mirror of #1366's device-prints-code flow.
 *
 * PUBLIC by design: a freshly installed till has no session and does not yet
 * know which organization it belongs to — the code is the credential, and the
 * grant it unlocks is what answers "whose device is this?". Brute force is
 * bounded by the per-grant exponential lockout in crouton-auth (#1661), which
 * is why this handler must not add its own pre-checks that could leak whether
 * a code exists.
 *
 * Also sets the canonical scoped-access cookie so an SSR-rendered till page is
 * authenticated on first paint, matching the redeem/mint endpoints.
 */
import { claimDevice } from '../../../utils/device-pairing'

const CODE_RE = /^[0-9A-HJ-NP-Z]{8}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ code?: string, deviceName?: string }>(event).catch(() => null)

  const code = body?.code?.trim().toUpperCase()
  const deviceName = body?.deviceName?.trim()

  if (!code || !CODE_RE.test(code)) {
    throw createError({ status: 400, statusText: 'Invalid pairing code' })
  }
  if (!deviceName) {
    throw createError({ status: 400, statusText: 'Device name is required' })
  }

  const result = await claimDevice({ code, deviceName })

  if (!result.ok) {
    if (result.retryAfterSeconds) {
      // h3 types Retry-After as numeric seconds — do not stringify it.
      setHeader(event, 'Retry-After', result.retryAfterSeconds)
    }
    throw createError({
      status: result.status,
      // Deliberately uniform: 'invalid' covers both an unknown and a wrong
      // code, so this response is not an enumeration oracle.
      statusText: result.reason === 'locked'
        ? 'Too many attempts'
        : result.reason === 'expired' || result.reason === 'exhausted'
          ? 'Pairing code is no longer valid'
          : 'Invalid pairing code'
    })
  }

  setCookie(event, 'scoped-access-token', result.token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    expires: result.tokenExpiresAt
  })

  return {
    deviceId: result.deviceId,
    orgId: result.orgId,
    eventId: result.eventId,
    token: result.token,
    expiresAt: result.tokenExpiresAt,
    // Returned exactly once — the till persists this to re-authenticate later.
    deviceSecret: result.deviceSecret
  }
})
