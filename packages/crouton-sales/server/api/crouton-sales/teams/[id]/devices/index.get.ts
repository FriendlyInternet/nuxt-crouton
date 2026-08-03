/**
 * List the team's claimed devices (#1662) — tills (`till-device`, this flow)
 * and print routers (`print-device`, #1366) together, since to an operator
 * they are one inventory.
 *
 * A device IS its scoped-access grant; secrets never leave the server. The
 * older `/print-devices` endpoint stays as-is for the routers-only view.
 */
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { listTeamDevices } from '../../../../utils/device-pairing'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  return listTeamDevices(team.id)
})
