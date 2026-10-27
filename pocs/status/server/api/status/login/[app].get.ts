import { appTargetFor } from '../../../utils/app-urls'
import { reviewLoginUrl, sanitizeWalk } from '../../../utils/review-login'

// Owner-only one-tap sign-in to an app's staging review login. The URL carries the
// password, so it is never logged or rendered into HTML — only a 302 Location.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const cfg = useRuntimeConfig(event)
  const owner = String(cfg.statusOwnerEmail || '').trim().toLowerCase()
  const session = await useServerAuth(event).api.getSession({ headers: event.headers }).catch(() => null)
  const email = String(session?.user?.email ?? '').trim().toLowerCase()
  if (!owner || !email || email !== owner) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const app = String(getRouterParam(event, 'app') ?? '')
  const key = String(getQuery(event).key ?? 'main')
  if (!/^[a-z0-9-]+$/.test(app) || !/^(main|pr\d+)$/.test(key)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }
  if (key !== 'main') {
    // PR preview URLs live in the deploy comment on the PR; not wired up yet.
    throw createError({ statusCode: 501, statusMessage: 'PR previews not supported yet' })
  }

  const target = appTargetFor(app)
  if (!target?.stagingUrl) {
    setResponseStatus(event, 404)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return `<!doctype html><meta charset="utf-8"><title>No staging URL</title><p>No staging URL is configured for <strong>${app}</strong>. Add <code>stagingUrl</code> to its deploy.config.json.</p>`
  }
  const base = target.stagingUrl

  // No sign-in for this app (opted out, or no seed secret here): just open its staging site.
  const secret = String(cfg.reviewSeedSecret || '')
  if (!target.hasSignIn || !secret) {
    return sendRedirect(event, base, 302)
  }

  return sendRedirect(event, reviewLoginUrl(base, secret, app, key, sanitizeWalk(getQuery(event).walk)), 302)
})
