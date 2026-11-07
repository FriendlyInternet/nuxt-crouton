import { createHash } from 'node:crypto'

// Role table (#3421) — mirrors the "Seed review login" step in .github/workflows/deploy-app.yml
// and scripts/seed-review-login.mjs; keep in sync:
//   admin      review+<app>-<key>@…            sha256(secret:app:key)            team owner
//   member     review+<app>-<key>-member@…     sha256(secret:app:key:member)     team member
//   superadmin review+<app>-<key>-superadmin@… sha256(secret:app:key:superadmin) team owner + user.superAdmin
export const REVIEW_ROLES = ['member', 'admin', 'superadmin'] as const
export type ReviewRole = typeof REVIEW_ROLES[number]

// Query value -> role. Missing -> 'admin' (today's login); anything unknown (or repeated) -> null.
export function parseReviewRole(raw: unknown): ReviewRole | null {
  if (raw === undefined || raw === '') return 'admin'
  return typeof raw === 'string' && (REVIEW_ROLES as readonly string[]).includes(raw) ? raw as ReviewRole : null
}

export function reviewLogin(secret: string, app: string, key: string, role: ReviewRole = 'admin') {
  const suffix = role === 'admin' ? '' : `-${role}`
  const salt = role === 'admin' ? '' : `:${role}`
  const password = createHash('sha256').update(`${secret}:${app}:${key}${salt}`).digest('hex').slice(0, 24)
  return { email: `review+${app}-${key}${suffix}@example.com`, password }
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

export function reviewLoginUrl(baseUrl: string, secret: string, app: string, key: string, redirect = '', walk = '', role: ReviewRole = 'admin'): string {
  const { email, password } = reviewLogin(secret, app, key, role)
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
