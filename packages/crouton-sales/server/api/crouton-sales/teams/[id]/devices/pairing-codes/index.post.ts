/**
 * Mint a one-time pairing code for this team (#1662) — the owner half of
 * #803's onboarding. The code is shown to the operator once and typed into a
 * freshly installed till, which then claims itself via
 * `POST /api/crouton-sales/devices/claim`.
 *
 * Team-member scoped: minting a code grants the ability to add a device to
 * this org, so it must never be public (the *claim* side is the public one,
 * protected by the grant lockout).
 */
import { mintPairingCode } from '@fyit/crouton-auth/server/utils/pairing-code'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<{ eventId?: string }>(event).catch(() => null)

  const { code, expiresAt } = await mintPairingCode({
    organizationId: team.id,
    eventId: body?.eventId?.trim() || undefined
  })

  // The plaintext code exists only in this response — it is stored hashed.
  return { code, expiresAt }
})
