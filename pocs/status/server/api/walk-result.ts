// POST /api/walk-result — post a finished walk's verdict on its epic (the walk's `ref`).
// Body: { ref?, steps: [{ text, verdict: 'works'|'issue', note? }] } → { data: { url } | null, error }
// No `ref` ⇒ nothing is posted. Re-sending returns the existing comment only if no commit/PR
// reference or other verdict came after it (postReply's guard).
// Called from the walk overlay on another staging app (velo.pmcp.dev → status.pmcp.dev): a credentialed
// fetch, so CORS allows exact staging origins from app-urls.generated.json (never a wildcard).
import { postReply } from '../utils/reply-core'
import { buildWalkReply, allowedWalkOrigins } from '../utils/walk-result-core'
import appUrls from '../utils/app-urls.generated.json'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  const origins = allowedWalkOrigins(appUrls as Record<string, { stagingUrl?: string }>, { dev: import.meta.dev })
  // Answers the preflight (OPTIONS) and sets the allow headers on the real response.
  if (handleCors(event, { origin: origins, credentials: true, methods: ['POST'], allowHeaders: ['content-type'], preflight: { statusCode: 204 } })) return
  assertMethod(event, 'POST')

  // Request-forgery check: a browser POST from any other site is refused.
  const origin = getRequestHeader(event, 'origin')
  if (origin && !origins.includes(origin)) throw createError({ statusCode: 403, statusMessage: 'Origin not allowed' })

  await requireStatusOwner(event)

  const parsed = buildWalkReply(await readBody(event).catch(() => ({})) ?? {})
  if (parsed.error) throw createError({ statusCode: 400, statusMessage: parsed.error })
  if (!parsed.data) return { data: null, error: null }

  const result = await postReply(REPO, parsed.data, githubToken(event))
  if (result.error || !result.data) throw createError({ statusCode: 502, statusMessage: result.error ?? 'GitHub unavailable' })

  return { data: { url: result.data.url }, error: null }
})
