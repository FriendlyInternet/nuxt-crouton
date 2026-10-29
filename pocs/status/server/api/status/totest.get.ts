// GET /api/status/totest — things waiting for the owner to try, with link + steps (see utils/totest.ts).
import { requireStatusOwner } from '../../utils/github'
import { listToTest } from '../../utils/totest'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  return listToTest(event)
})
