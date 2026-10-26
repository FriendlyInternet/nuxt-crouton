import { stagingUrlFor } from '../../../utils/app-urls'
import { reviewLoginUrl } from '../../../utils/review-login'

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

  const secret = String(cfg.reviewSeedSecret || '')
  const base = stagingUrlFor(app)
  if (!secret || !base) {
    throw createError({ statusCode: 404, statusMessage: 'No review login for this app' })
  }

  return sendRedirect(event, reviewLoginUrl(base, secret, app, key), 302)
})
