import { appTargetFor } from '../../../utils/app-urls'
import { reviewLoginUrl } from '../../../utils/review-login'
import { listLiveApps, listPreviews } from '../../../utils/live-apps'
import { resolvePreviewUrl } from '../../../utils/live-apps-core'

// Owner-only one-tap sign-in to an app's staging review login. The URL carries the
// password, so it is never logged or rendered into HTML — only a 302 Location.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const cfg = useRuntimeConfig(event)
  const owner = String(cfg.statusOwnerEmail || '').trim().toLowerCase()
  const session = await useServerAuth(event).api.getSession({ headers: event.headers }).catch(() => null)
  const email = String(session?.user?.email ?? '').trim().toLowerCase()
  if (!email) {
    // Signed out: send to sign-in and come back here afterwards (path is built from a validated slug).
    const slug = String(getRouterParam(event, 'app') ?? '')
    const back = /^[a-z0-9-]+$/.test(slug) ? `/api/status/login/${slug}` : '/'
    return sendRedirect(event, `/auth/login?redirect=${encodeURIComponent(back)}`, 302)
  }
  if (!owner || email !== owner) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const app = String(getRouterParam(event, 'app') ?? '')
  const key = String(getQuery(event).key ?? 'main')
  if (!/^[a-z0-9-]+$/.test(app) || !/^(main|pr\d+)$/.test(key)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }
  // Live list from GitHub; the build-time list is only a fallback if GitHub is unreachable.
  const live = await listLiveApps(event)
  const liveApp = live.data.find(a => a.app === app)
  const target = liveApp
    ? { stagingUrl: liveApp.stagingUrl, hasSignIn: liveApp.hasSignIn }
    : appTargetFor(app)
  if (!target?.stagingUrl) {
    setResponseStatus(event, 404)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return `<!doctype html><meta charset="utf-8"><title>No staging URL</title><p>No staging URL is configured for <strong>${app}</strong>. Add <code>stagingUrl</code> to its deploy.config.json.</p>`
  }
  let base = target.stagingUrl
  if (key !== 'main') {
    const previewUrl = resolvePreviewUrl((await listPreviews(event)).data, app, key)
    if (!previewUrl) throw createError({ statusCode: 404, statusMessage: 'No open preview for that PR' })
    base = previewUrl
  }

  // No sign-in for this app (opted out, or no seed secret here): just open its staging site.
  const secret = String(cfg.reviewSeedSecret || '')
  if (!target.hasSignIn || !secret) {
    return sendRedirect(event, base, 302)
  }

  return sendRedirect(event, reviewLoginUrl(base, secret, app, key), 302)
})
