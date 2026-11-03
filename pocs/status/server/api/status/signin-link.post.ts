import { maskEmail, rateLimitOk, safeRedirect, sendSignInLink } from '../../utils/signin-link-core'

// Owner-only sign-in: emails a magic link to the configured owner address. The caller
// supplies no address, so this can never mail anyone else. Rate limited to 1 per minute.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const owner = String(useRuntimeConfig(event).statusOwnerEmail || '').trim().toLowerCase()
  if (!owner) {
    throw createError({ statusCode: 503, statusMessage: 'Sign-in is not configured: NUXT_STATUS_OWNER_EMAIL is not set on this build.' })
  }

  const body = await readBody(event).catch(() => null)
  const redirect = safeRedirect(body?.redirect)

  const storage = useStorage('cache')
  const key = 'status:signin-link:last'
  const last = Number(await storage.getItem(key)) || null
  const now = Date.now()
  if (!rateLimitOk(last, now)) {
    throw createError({ statusCode: 429, statusMessage: 'A sign-in link was just sent. Wait a minute before asking again.' })
  }
  await storage.setItem(key, now)

  try {
    await sendSignInLink(useServerAuth(event).api, { email: owner, callbackURL: redirect, headers: event.headers })
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 501) {
      throw createError({ statusCode: 501, statusMessage: 'Magic-link sign-in is not enabled on this build.' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Could not send the sign-in link.' })
  }
  return { sent: true, hint: maskEmail(owner) }
})
