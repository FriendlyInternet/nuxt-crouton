// GET /api/cards/token-account — which GitHub account the app's token posts as.
// → { data: { login, isOwner }, error }. Card answers are refused unless isOwner is true.
import { OWNER_LOGIN, tokenLogin } from '../../utils/cards-answer-core'
import { githubToken, requireStatusOwner } from '../../utils/github'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const who = await tokenLogin(githubToken(event))
  if (who.error || !who.data) throw createError({ statusCode: 502, statusMessage: who.error ?? 'GitHub unavailable' })
  return { data: { login: who.data.login, isOwner: who.data.login === OWNER_LOGIN }, error: null }
})
