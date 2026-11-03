// GET /api/status/apps — every app with a deploy.config.json, its staging URL, open PR previews
// and whether it has a review login. URLs only; the sign-in link stays behind /api/status/login.
import { requireStatusOwner } from '../../utils/github'
import { listLiveApps, listPreviews } from '../../utils/live-apps'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const [apps, previews] = await Promise.all([listLiveApps(event), listPreviews(event)])
  const data = apps.data.map(a => ({
    app: a.app,
    stagingUrl: a.stagingUrl,
    hasSignIn: a.hasSignIn,
    previews: previews.data.filter(p => p.app === a.app).map(({ pr, title, updatedAt, url }) => ({ pr, title, updatedAt, url }))
  }))
  const errors = [apps.error, previews.error].filter(Boolean)
  return { data, error: errors.length ? errors.join('; ') : null }
})
