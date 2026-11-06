import { parseReviewRole, withWalk, type ReviewRole } from './review-login'
import { isSafePath } from './totest-core'

type Q = Record<string, unknown>

const SLUG = /^[a-z0-9-]+$/
const KEY = /^(main|pr\d+)$/

/** Where a signed-out tap should return to; key/role are re-validated so the role survives. */
export function signedOutBackPath(slug: string, q: Q): string {
  if (!SLUG.test(slug)) return '/'
  const params = new URLSearchParams()
  if (KEY.test(String(q.key ?? ''))) params.set('key', String(q.key))
  const role = parseReviewRole(q.role)
  if (role && q.role) params.set('role', role)
  const qs = params.toString()
  return `/api/status/login/${slug}${qs ? `?${qs}` : ''}`
}

export type LoginRequest = { app: string, key: string, role: ReviewRole, to: string }

/** Validate slug, key, role and `to`; null means 400. */
export function parseLoginRequest(slug: string, q: Q): LoginRequest | null {
  const key = String(q.key ?? 'main')
  if (!SLUG.test(slug) || !KEY.test(key)) return null
  const role = parseReviewRole(q.role)
  if (!role) return null
  const to = q.to === undefined || q.to === '' ? '' : String(q.to)
  if (to && !isSafePath(to)) return null
  return { app: slug, key, role, to }
}

/** Live entry wins; the build-time target is the fallback when GitHub is unreachable. */
export function normalizeTarget(
  liveApp: { stagingUrl?: string | null, hasSignIn: boolean } | undefined,
  fallback: { stagingUrl?: string | null, hasSignIn: boolean } | null | undefined
) {
  const t = liveApp ?? fallback
  return t ? { stagingUrl: t.stagingUrl ?? '', hasSignIn: t.hasSignIn } : null
}

/** Redirect target when the app has no sign-in: its site, optionally deep-linked. */
export function plainSiteUrl(base: string, to: string, walk: string): string {
  return to || walk ? `${base.replace(/\/+$/, '')}${withWalk(to, walk)}` : base
}
