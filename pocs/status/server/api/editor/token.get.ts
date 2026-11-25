import { deriveEditorSecret, safeEditorReturn, signEditorToken } from '../../utils/editor-token-core'

// Owner-only: mints a 10-minute token the ticket-editor worker requires to save (#3261), then
// sends the owner back to the editor with it in the URL fragment (never logged server-side).
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const back = safeEditorReturn(getQuery(event).return)
  if (!back) throw createError({ statusCode: 400, statusMessage: 'Bad request' })

  const cfg = useRuntimeConfig(event)
  const owner = String(cfg.statusOwnerEmail || '').trim().toLowerCase()
  const seed = String(cfg.reviewSeedSecret || '')
  if (!seed) throw createError({ statusCode: 503, statusMessage: 'Editor sign-in not configured' })

  const session = await useServerAuth(event).api.getSession({ headers: event.headers }).catch(() => null)
  const email = String(session?.user?.email ?? '').trim().toLowerCase()
  if (!email) {
    const here = `/api/editor/token?return=${encodeURIComponent(back)}`
    return sendRedirect(event, `/signin?redirect=${encodeURIComponent(here)}`, 302)
  }
  if (!owner || email !== owner) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = await signEditorToken(await deriveEditorSecret(seed), Date.now())
  return sendRedirect(event, `${back}#owner=${token}`, 302)
})
