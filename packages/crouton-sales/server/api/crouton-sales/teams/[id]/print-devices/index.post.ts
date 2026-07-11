/**
 * Claim a print device for this team (#1366) — the app half of the inverse
 * pairing: the router printed its Router-ID + code, the operator types them
 * here. The claim is a scoped-access grant whose `organizationId` answers
 * "whose device is this?" on every poll; the code (hashed) becomes the
 * device's per-team credential, replacing the shared API key.
 *
 * One device belongs to ONE team: a device already claimed by another team
 * answers 409 — revoke there first (possession of the printed code is not
 * proof of *ownership transfer*, so we refuse rather than silently steal).
 */
import { eq, and, ne } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { upsertScopedGrant } from '@fyit/crouton-auth/server/utils/scoped-access'
import { scopedAccessGrant } from '@fyit/crouton-auth/server/database/schema/auth'

const DEVICE_ID_RE = /^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/
const CODE_RE = /^\d{4,8}$/

function requireMatch(value: string | undefined, re: RegExp, statusText: string): string {
  if (!value || !re.test(value)) {
    throw createError({ status: 400, statusText })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<{ deviceId?: string, code?: string }>(event).catch(() => null)
  const deviceId = requireMatch(body?.deviceId?.trim().toLowerCase(), DEVICE_ID_RE, 'Invalid device id')
  const code = requireMatch(body?.code?.trim(), CODE_RE, 'Invalid pairing code')

  const db = useDB()
  const [foreign] = await db
    .select({ id: scopedAccessGrant.id })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.resourceType, 'print-device'),
        eq(scopedAccessGrant.resourceId, deviceId),
        eq(scopedAccessGrant.isActive, true),
        ne(scopedAccessGrant.organizationId, team.id)
      )
    )
    .limit(1)

  if (foreign) {
    throw createError({ status: 409, statusText: 'Device is claimed by another team' })
  }

  await upsertScopedGrant({
    organizationId: team.id,
    resourceType: 'print-device',
    resourceId: deviceId,
    secret: code,
    role: 'device',
    credentialType: 'pin'
  })

  return { claimed: true, deviceId }
})
