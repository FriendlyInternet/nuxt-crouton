// Owner-only access: sign-up is closed and only STATUS_OWNER_EMAIL may ask for a
// sign-in link. Everyone else gets a 403. Fails closed when the owner email is unset.
const SIGN_UP = /^\/api\/auth\/sign-up(\/|$)/
const SIGN_IN = /^\/api\/auth\/sign-in(\/|$)/

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  if (event.method !== 'POST') return

  const isSignUp = SIGN_UP.test(path)
  if (!isSignUp && !SIGN_IN.test(path)) return

  const owner = String(useRuntimeConfig(event).statusOwnerEmail || '').trim().toLowerCase()
  const body = isSignUp ? null : await readBody(event).catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()

  if (isSignUp || !owner || email !== owner) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
})
