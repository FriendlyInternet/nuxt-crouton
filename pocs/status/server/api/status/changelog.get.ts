// GET /api/status/changelog — PRs merged to main in the last 30 days (owner-only).
import { buildChangelog, type GhPull } from '../../utils/changelog-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const { data, error } = await ghFetch<GhPull[]>(
    event,
    `/repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`
  )
  if (error || !data) return { data: null, error: error ?? 'No data from GitHub' }
  return { data: buildChangelog(data), error: null }
})
