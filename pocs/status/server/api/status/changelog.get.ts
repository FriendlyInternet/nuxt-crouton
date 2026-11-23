// GET /api/status/changelog — PRs merged to main in the last 30 days (owner-only).
// Each row's tag comes from its linked issue's labels, read with one cached issue search (two pages
// at most). If that search fails, every row falls back to the PR's own labels; the tab still loads.
import { buildChangelog, issueLabelMap, issueSearchPath, type GhIssueLabels, type GhPull } from '../../utils/changelog-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const { data, error } = await ghFetch<GhPull[]>(
    event,
    `/repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`
  )
  if (error || !data) return { data: null, error: error ?? 'No data from GitHub' }

  let issues: Map<number, string[]> | null = null
  const path1 = issueSearchPath(data)
  if (path1) {
    const page1 = await ghFetch<{ items?: GhIssueLabels[] }>(event, path1)
    const items = page1.data?.items
    if (!page1.error && Array.isArray(items)) {
      let all = items
      if (items.length >= 100) {
        const page2 = await ghFetch<{ items?: GhIssueLabels[] }>(event, issueSearchPath(data, 2)!)
        if (!page2.error && Array.isArray(page2.data?.items)) all = [...items, ...page2.data!.items!]
      }
      issues = issueLabelMap(all)
    }
  }
  return { data: buildChangelog(data, new Date(), 30, issues), error: null }
})
