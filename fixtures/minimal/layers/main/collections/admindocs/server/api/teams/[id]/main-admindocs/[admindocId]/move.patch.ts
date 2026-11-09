// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updatePositionMainAdmindoc } from '../../../../../database/queries'
import { requireTeamRole } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { admindocId } = getRouterParams(event)
  if (!admindocId) {
    throw createError({ status: 400, statusText: 'Missing admindoc ID' })
  }

  const authTimer = timing.start('auth')
  const { team } = await requireTeamRole(event, 'admin')
  authTimer.end()

  const body = await readBody(event)

  // Validate input
  if (body.order === undefined || typeof body.order !== 'number') {
    throw createError({ status: 400, statusText: 'order is required and must be a number' })
  }

  // parentId can be null (move to root) or a valid ID
  const parentId = body.parentId ?? null

  const dbTimer = timing.start('db')
  const result = await updatePositionMainAdmindoc(team.id, admindocId, parentId, body.order)
  dbTimer.end()
  return result
})