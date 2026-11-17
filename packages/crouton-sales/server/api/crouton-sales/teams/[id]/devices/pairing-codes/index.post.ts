/**
 * Mint a one-time pairing code for this team (#1662) — the owner half of
 * #803's onboarding. The code is shown to the operator once and typed into a
 * freshly installed till, which then claims itself via
 * `POST /api/crouton-sales/devices/claim`.
 *
 * Team-member scoped: minting a code grants the ability to add a device to
 * this org, so it must never be public (the *claim* side is the public one,
 * protected by the grant lockout).
 *
 * An optional `eventId` must be one of this team's events, else 404 (#3992).
 */
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { mintTeamPairingCode } from '../../../../../../utils/device-pairing'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<{ eventId?: string }>(event).catch(() => null)

  const result = await mintTeamPairingCode({
    organizationId: team.id,
    eventId: body?.eventId
  })

  if (!result.ok) {
    throw createError({ status: result.status, statusText: 'Event not found' })
  }

  // The plaintext code exists only in this response — it is stored hashed.
  return { code: result.code, expiresAt: result.expiresAt }
})
