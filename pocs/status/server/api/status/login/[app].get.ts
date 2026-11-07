import { appTargetFor } from '../../../utils/app-urls'
import { reviewLoginUrl, sanitizeWalk, withWalk } from '../../../utils/review-login'
import { listLiveApps, resolvePrLogin } from '../../../utils/live-apps'
import { ownerGate, parseLoginRequest, pickLoginTarget, plainRedirectUrl } from '../../../utils/login-request-core'
import { loginPlan } from '../../../utils/live-apps-core'

// Owner-only one-tap sign-in to an app's staging review login. The URL carries the
// password, so it is never logged or rendered into HTML — only a 302 Location.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const cfg = useRuntimeConfig(event)
  const session = await useServerAuth(event).api.getSession({ headers: event.headers }).catch(() => null)
  const email = session?.user?.email
  const gate = ownerGate(email, cfg.statusOwnerEmail, String(getRouterParam(event, 'app') ?? ''), getQuery(event))
  if (gate.kind === 'signin') return sendRedirect(event, gate.location, 302)
  if (gate.kind === 'deny') throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const req = parseLoginRequest(String(getRouterParam(event, 'app') ?? ''), getQuery(event))
  if (!req) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }
  const { app, key, role, to } = req
  // Live list from GitHub; the build-time list is only a fallback if GitHub is unreachable.
  const live = await listLiveApps(event)
  const liveApp = live.data.find(a => a.app === app)
  const normalized = pickLoginTarget(liveApp, appTargetFor(app))
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
    return sendRedirect(event, plainRedirectUrl(base, to, walk, withWalk), 302)
  }

  return sendRedirect(event, reviewLoginUrl(base, secret, app, key, to, walk, role), 302)
})
