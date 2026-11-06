// GET /api/status/decisions — decisions from open + recently closed epics, plus what waits on the owner.
import { requireStatusOwner } from '../../utils/github'
import { listDecisions } from '../../utils/decisions'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  return listDecisions(event)
})
