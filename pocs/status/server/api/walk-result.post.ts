// POST /api/walk-result — post a finished walk's verdict on its epic (the walk's `ref`).
// Body: { ref?, steps: [{ text, verdict: 'works'|'issue', note? }] } → { data: { url } | null, error }
// No `ref` ⇒ nothing is posted. Re-sending the same result returns the existing comment (postReply's guard).
import { postReply } from '../utils/reply-core'
import { buildWalkReply } from '../utils/walk-result-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)

  const parsed = buildWalkReply(await readBody(event).catch(() => ({})) ?? {})
  if (parsed.error) throw createError({ statusCode: 400, statusMessage: parsed.error })
  if (!parsed.data) return { data: null, error: null }

  const result = await postReply(REPO, parsed.data, githubToken(event))
  if (result.error || !result.data) throw createError({ statusCode: 502, statusMessage: result.error ?? 'GitHub unavailable' })

  return { data: { url: result.data.url }, error: null }
})
