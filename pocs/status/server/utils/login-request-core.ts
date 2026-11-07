import { parseReviewRole, type ReviewRole } from './review-login'
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

/** True only when both emails are non-empty and equal (case/space-insensitive). */
export function isOwnerEmail(email: unknown, owner: unknown): boolean {
  const e = String(email ?? '').trim().toLowerCase()
  const o = String(owner ?? '').trim().toLowerCase()
  return !!e && !!o && e === o
}

/** Where to send the tap when the app has no sign-in: its site, optionally at `to` + walk. */
export function plainRedirectUrl(base: string, to: string, walk: string, withWalkFn: (to: string, walk: string) => string): string {
  return to || walk ? `${base.replace(/\/+$/, '')}${withWalkFn(to, walk)}` : base
}

type TargetIn = { stagingUrl?: string | null, hasSignIn: boolean }

/** Prefer the live GitHub entry, else the build-time fallback; null when neither knows the app. */
export function pickLoginTarget(live: TargetIn | undefined, fallback: TargetIn | null | undefined): { stagingUrl: string, hasSignIn: boolean } | null {
  const t = live ?? fallback
  return t ? { stagingUrl: t.stagingUrl ?? '', hasSignIn: t.hasSignIn } : null
}

export type OwnerGate = { kind: 'ok' } | { kind: 'signin', location: string } | { kind: 'deny' }

/** Signed-out -> bounce to /signin (keeping the tap); signed-in non-owner -> deny. */
export function ownerGate(email: unknown, owner: unknown, slug: string, q: Q): OwnerGate {
  if (!String(email ?? '').trim()) {
    return { kind: 'signin', location: `/signin?redirect=${encodeURIComponent(signedOutBackPath(slug, q))}` }
  }
  return isOwnerEmail(email, owner) ? { kind: 'ok' } : { kind: 'deny' }
}
