import { randomUUID, timingSafeEqual } from 'node:crypto'
import { previewSessionToken } from '../../utils/review-login'

// Preview-only sign-in for CI (#2700). The deploy pushes NUXT_REVIEW_PREVIEW_KEY (`pr<N>`) ONLY to
// PR preview Workers, so on staging and production `reviewPreviewKey` is empty and this route is a
// plain 404. On a preview it signs in as the owner when the caller presents the token derived from
// the review seed secret — which only CI (and the deploy) can compute.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const cfg = useRuntimeConfig(event)
  const key = String(cfg.reviewPreviewKey || '')
  const secret = String(cfg.reviewSeedSecret || '')
  const owner = String(cfg.statusOwnerEmail || '').trim().toLowerCase()
  if (!/^pr\d+$/.test(key) || !secret || !owner) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const given = Buffer.from(String(getQuery(event).token ?? ''))
  const want = Buffer.from(previewSessionToken(secret, 'status', key))
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  // Mint a one-shot magic-link record for the owner and redeem it through the auth plugin itself,
  // so the session + cookie are created exactly as for a real emailed link.
  const auth = useServerAuth(event)
  const ctx = await (auth as any).$context
  const link = randomUUID().replace(/-/g, '')
  await ctx.internalAdapter.createVerificationValue({
    identifier: `magic-link:${link}`,
    value: JSON.stringify({ type: 'magic-link', email: owner }),
    expiresAt: new Date(Date.now() + 60_000)
  })
  const res: Response = await (auth.api as any).magicLinkVerify({
    query: { token: link },
    headers: event.headers,
    asResponse: true
  })
  for (const cookie of res.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: 'Sign-in failed' })
  return { ok: true }
})
