// GET /api/status/apps — every app with a deploy.config.json, its staging URL, open PR previews
// and whether it has a review login, and, per preview, whether the inbox has a waiting review card
// for it (`asksOwner`, #3045). URLs only; the sign-in link stays behind /api/status/login.
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { requireStatusOwner } from '../../utils/github'
import { listLiveApps, listPreviews } from '../../utils/live-apps'
import { previewAsksOwner, type WaitingCard } from '../../utils/live-apps-core'
import { getAllInboxCards } from '../../../layers/inbox/collections/cards/server/database/queries'

async function readCards(event: Parameters<typeof resolveTeamAndCheckMembership>[0]): Promise<{ cards: WaitingCard[] | null, error: string | null }> {
  try {
    const { team } = await resolveTeamAndCheckMembership(event)
    const cards = await getAllInboxCards(team.id)
    return { cards: cards as unknown as WaitingCard[], error: null }
  } catch (e) {
    console.error('[status/apps]', e)
    return { cards: null, error: `Could not read the inbox: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const [apps, previews, inbox] = await Promise.all([listLiveApps(event), listPreviews(event), readCards(event)])
  const cards = inbox.cards
  const data = apps.data.map(a => ({
    app: a.app,
    stagingUrl: a.stagingUrl,
    hasSignIn: a.hasSignIn,
    previews: previews.data.filter(p => p.app === a.app).map(({ pr, title, updatedAt, url }) => ({
      pr, title, updatedAt, url, asksOwner: cards ? previewAsksOwner(pr, cards) : true
    }))
  }))
  const errors = [apps.error, previews.error, inbox.error].filter(Boolean)
  return { data, error: errors.length ? errors.join('; ') : null }
})
