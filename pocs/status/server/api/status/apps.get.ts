// GET /api/status/apps — one card per app (plus a null "General" card): staging URL, owner sign-in
// path, open PR previews, things to test (PR previews' merged PRs + epics), open questions and
// decisions; most to-test first. The sign-in link stays behind /api/status/login (owner-only 302).
import { requireStatusOwner } from '../../utils/github'
import { listLiveApps, listPreviews } from '../../utils/live-apps'
import { listToTest } from '../../utils/totest'
import { listDecisions } from '../../utils/decisions'
import { buildAppCards } from '../../utils/apps-core'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const [apps, previews, toTest, dec] = await Promise.all([
    listLiveApps(event), listPreviews(event), listToTest(event),
    listDecisions(event).catch((e: { statusMessage?: string }) => ({ data: null, error: e.statusMessage ?? 'decisions unavailable' }))
  ])
  const data = buildAppCards({
    apps: apps.data,
    previews: previews.data,
    toTest: toTest.data,
    questions: dec.data?.openQuestions ?? [],
    decisions: dec.data?.decisions ?? []
  })
  const errors = [apps.error, previews.error, toTest.error, dec.error].filter(Boolean)
  return { data, error: errors.length ? errors.join('; ') : null }
})
