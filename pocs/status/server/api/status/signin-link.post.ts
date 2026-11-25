import { maskEmail, rateLimitOk, safeRedirect, SIGNIN_LINK_GLOBAL_MAX, sendSignInLink, signinLimitKeys } from '../../utils/signin-link-core'

// Owner-only sign-in: emails a magic link to the configured owner address. The caller
// supplies no address, so this can never mail anyone else. Rate limited to 1 per minute per IP, 10 per hour overall.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const owner = String(useRuntimeConfig(event).statusOwnerEmail || '').trim().toLowerCase()
  if (!owner) {
    throw createError({ statusCode: 503, statusMessage: 'Sign-in is not configured: NUXT_STATUS_OWNER_EMAIL is not set on this build.' })
  }

  const body = await readBody(event).catch(() => null)
  const redirect = safeRedirect(body?.redirect)

  // Durable KV (NuxtHub mount), shared by every Worker instance. Per client IP + an hourly global cap.
  const store = useStorage('kv')
  const ip = getRequestHeader(event, 'cf-connecting-ip') || getRequestIP(event, { xForwardedFor: true }) || null
  const now = Date.now()
  const keys = signinLimitKeys(ip, now)
  const lastIp = keys.ip ? Number(await store.getItem(keys.ip)) || null : null
  const globalCount = Number(await store.getItem(keys.global)) || 0
  if (!rateLimitOk(lastIp, now)) {
    throw createError({ statusCode: 429, statusMessage: 'A sign-in link was just sent. Wait a minute before asking again.' })
  }
  if (globalCount >= SIGNIN_LINK_GLOBAL_MAX) {
    throw createError({ statusCode: 429, statusMessage: 'Too many sign-in links this hour. Try again later.' })
  }

  try {
    await sendSignInLink(useServerAuth(event).api, { email: owner, callbackURL: redirect, headers: event.headers })
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 501) {
      throw createError({ statusCode: 501, statusMessage: 'Magic-link sign-in is not enabled on this build.' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Could not send the sign-in link.' })
  }
  // Only a successful send uses up the limit (Cloudflare KV needs ttl >= 60).
  if (keys.ip) await store.setItem(keys.ip, now, { ttl: 120 })
  await store.setItem(keys.global, globalCount + 1, { ttl: 3_700 })
  return { sent: true, hint: maskEmail(owner) }
})
