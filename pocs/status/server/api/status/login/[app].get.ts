import type { H3Event } from 'h3'
import { appTargetFor } from '../../../utils/app-urls'
import { parseReviewRole, reviewLoginUrl, sanitizeWalk, withWalk } from '../../../utils/review-login'
import { listLiveApps, resolvePrLogin } from '../../../utils/live-apps'
import { isSafePath } from '../../../utils/totest-core'
import { loginPlan } from '../../../utils/live-apps-core'

// Signed out: where to come back to after sign-in (path is built from a validated slug).
// key/role are re-validated here so a signed-out tap comes back as the same role.
function signedOutBack(event: H3Event): string {
  const slug = String(getRouterParam(event, 'app') ?? '')
  if (!/^[a-z0-9-]+$/.test(slug)) return '/'
  const q = getQuery(event)
  const params = new URLSearchParams()
  if (/^(main|pr\d+)$/.test(String(q.key ?? ''))) params.set('key', String(q.key))
  const role = parseReviewRole(q.role)
  if (role && q.role) params.set('role', role)
  const qs = params.toString()
  return `/api/status/login/${slug}${qs ? `?${qs}` : ''}`
}

/** Validated app/key/role/to from the query, or null if any is malformed. */
function parseLoginRequest(event: H3Event) {
  const q = getQuery(event)
  const req = parseLoginRequest(event)
  if (!req) throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  const { app, key, role, to } = req
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

  return sendRedirect(event, reviewLoginUrl(base, secret, app, key, to, walk, role), 302)
})
