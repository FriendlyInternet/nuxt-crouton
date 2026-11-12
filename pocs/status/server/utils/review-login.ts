import { createHash } from 'node:crypto'
import { isSafePath } from '../../shared/safe-path'

// Mirrors the "Seed review login" step in .github/workflows/deploy-app.yml — keep in sync.
export function reviewLogin(secret: string, app: string, key: string) {
  const password = createHash('sha256').update(`${secret}:${app}:${key}`).digest('hex').slice(0, 24)
  return { email: `review+${app}-${key}@example.com`, password }
}

// The `walk` link param (base64url JSON, <= 2 KB): shape-checked only, the app parses it.
export function sanitizeWalk(raw: unknown): string {
  return typeof raw === 'string' && raw.length <= 2048 && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : ''
}

// Carry the walk alongside the page deep link: `/page` + walk -> `/page?walk=…`.
export function withWalk(to: string, walk: string): string {
  if (!walk) return to
  return `${to || '/'}${(to || '/').includes('?') ? '&' : '?'}walk=${walk}`
}

// Where a signed-out tap on /api/status/login/<app> comes back to after the sign-in mail (#3840).
// Keeps `key`, `to` and `walk` only when they pass the same checks the route applies; anything
// else (and every other param) is dropped, so raw input never passes through.
export function signedOutBackPath(slug: unknown, query: Record<string, unknown>): string {
  const app = typeof slug === 'string' ? slug : ''
  if (!/^[a-z0-9-]+$/.test(app)) return '/'
  const q = new URLSearchParams()
  const key = query.key
  if (typeof key === 'string' && /^pr\d+$/.test(key)) q.set('key', key)
  const to = query.to
  if (typeof to === 'string' && to && isSafePath(to)) q.set('to', to)
  const walk = sanitizeWalk(query.walk)
  if (walk) q.set('walk', walk)
  const qs = q.toString()
  return `/api/status/login/${app}${qs ? `?${qs}` : ''}`
}

export function reviewLoginUrl(baseUrl: string, secret: string, app: string, key: string, redirect = '', walk = ''): string {
  const { email, password } = reviewLogin(secret, app, key)
  const q = new URLSearchParams({ email, password })
  const target = withWalk(redirect, walk)
  if (target) q.set('redirect', target)
  return `${baseUrl.replace(/\/+$/, '')}/auth/login?${q}`
}

// Preview-only sign-in token (#2700): lets CI capture a screenshot of a PR preview even though
// this app has no password to sign in with. Mirrors previewSessionToken in
// scripts/lib/review-login.mjs — keep in sync.
export function previewSessionToken(secret: string, app: string, key: string): string {
  return createHash('sha256').update(`${secret}:${app}:preview-session:${key}`).digest('hex').slice(0, 32)
}
