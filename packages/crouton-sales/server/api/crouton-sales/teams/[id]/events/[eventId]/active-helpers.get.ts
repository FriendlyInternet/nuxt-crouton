import { requireTeamEvent } from '../../../../../../utils/team-event'
import { listScopedTokensForResource } from '@fyit/crouton-auth/server/utils/scoped-access'

export default defineEventHandler(async (event) => {
  // requireTeamEvent validates the event belongs to this team, so a foreign
  // eventId gets a 404 instead of leaking another team's helper tokens
  // (this endpoint doesn't otherwise scope the token query by team).
  const { eventId } = await requireTeamEvent(event)

  return listScopedTokensForResource('event', eventId)
})
