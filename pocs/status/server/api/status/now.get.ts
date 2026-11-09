// GET /api/status/now — Now / Next / Waiting for you, derived live from GitHub (see utils/now.ts).
import { requireStatusOwner } from '../../utils/github'
import { listNow } from '../../utils/now'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  return listNow(event)
})
