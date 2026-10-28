import { createRateLimiter, maskEmail, safeRedirect } from '../../utils/signin-link-core'

// Per Worker instance — holds against casual repeats, not a shared limit.
const allow = createRateLimiter(60_000)

// One-tap sign-in: mails the magic link to the configured owner address, whatever the
// caller sends. The recipient is never taken from the request, so this can't mail anyone else.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const owner = String(useRuntimeConfig(event).statusOwnerEmail || '').trim()
  if (!owner) {
    throw createError({ statusCode: 503, statusMessage: 'Sign-in is not configured (NUXT_STATUS_OWNER_EMAIL is not set)' })
  }
  if (!allow('owner')) {
    throw createError({ statusCode: 429, statusMessage: 'A link was just sent — check your inbox, or try again in a minute.' })
  }

  const body = await readBody(event).catch(() => null)
  const target = safeRedirect(body?.redirect)
  const origin = getRequestURL(event).origin

  try {
    await useServerAuth(event).api.signInMagicLink({
      body: { email: owner, callbackURL: origin + target },
      headers: event.headers
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not send the sign-in link. Try again shortly.' })
  }

  return { sent: true, hint: maskEmail(owner) }
})
