// POST /api/reply — post `ok` / `not ok: <note>` on an epic or PR as the owner.
// Body: { kind: 'issue'|'pr', number, verdict: 'ok'|'not-ok', note? } → { data: { url }, error }
import { buildReply, postReply } from '../utils/reply-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)

  const parsed = buildReply(await readBody(event).catch(() => ({})) ?? {})
  if (parsed.error || !parsed.data) throw createError({ statusCode: 400, statusMessage: parsed.error ?? 'Bad request' })

  const result = await postReply(REPO, parsed.data, githubToken(event))
  if (result.error || !result.data) throw createError({ statusCode: 502, statusMessage: result.error ?? 'GitHub unavailable' })

  return { data: { url: result.data.url }, error: null }
})
