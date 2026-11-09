import { appTargetFor } from '../../../utils/app-urls'
import { reviewLoginUrl, sanitizeWalk, withWalk } from '../../../utils/review-login'
import { listLiveApps, resolvePrLogin } from '../../../utils/live-apps'
import { isSafePath } from '../../../utils/totest-core'
import { loginPlan } from '../../../utils/live-apps-core'

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
    return sendRedirect(event, `/signin?redirect=${encodeURIComponent(back)}`, 302)
  }
  if (!owner || email !== owner) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const app = String(getRouterParam(event, 'app') ?? '')
  const key = String(getQuery(event).key ?? 'main')
  if (!/^[a-z0-9-]+$/.test(app) || !/^(main|pr\d+)$/.test(key)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }
  const toRaw = getQuery(event).to
  const to = toRaw === undefined || toRaw === '' ? '' : String(toRaw)
  if (to && !isSafePath(to)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }
  // Live list from GitHub; the build-time list is only a fallback if GitHub is unreachable.
  const live = await listLiveApps(event)
  const liveApp = live.data.find(a => a.app === app)
  const target = liveApp
    ? { stagingUrl: liveApp.stagingUrl ?? '', hasSignIn: liveApp.hasSignIn }
    : appTargetFor(app)
  const normalized = target ? { stagingUrl: target.stagingUrl ?? '', hasSignIn: target.hasSignIn } : null
  const decision = key === 'main' ? undefined : await resolvePrLogin(event, app, key)
  const secret = String(cfg.reviewSeedSecret || '')
  const plan = loginPlan(normalized, app, key, !!secret, decision)
  if (plan.kind === 'page') {
    setResponseStatus(event, plan.status)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return plan.html
  }
  const base = plan.base
  const walk = sanitizeWalk(getQuery(event).walk)

  // No sign-in for this app (opted out, or no seed secret here): just open its site.
  if (!plan.signIn) {
    return sendRedirect(event, to || walk ? `${base.replace(/\/+$/, '')}${withWalk(to, walk)}` : base, 302)
  }

  return sendRedirect(event, reviewLoginUrl(base, secret, app, key, to, walk), 302)
})
