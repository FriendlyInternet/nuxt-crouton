/**
 * POST /api/teams/[id]/domains
 *
 * Add a new custom domain to a team/organization.
 * Requires team owner role.
 */
import { z } from 'zod'
import { requireTeamOwner } from '../../../../utils/team'
import { useDB, tables, eq, and, generateVerificationToken } from '../../../../utils/database'

const addDomainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .transform(d => d.toLowerCase().trim())
    .refine(
      d => /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(d),
      'Invalid domain format'
    )
})

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamOwner(event)

  const body = await readValidatedBody(event, addDomainSchema.parse)

  const db = useDB()

  // Only a VERIFIED claim (or this team's own row) blocks the name. An unverified
  // claim by another team must not squat it; ownership is proven at verify time.
  const [verifiedElsewhere, ownRow] = await Promise.all([
    db.select().from(tables.domain)
      .where(and(eq(tables.domain.domain, body.domain), eq(tables.domain.status, 'verified')))
      .get(),
    db.select().from(tables.domain)
      .where(and(eq(tables.domain.domain, body.domain), eq(tables.domain.organizationId, team.id)))
      .get()
  ])
  const existingDomain = verifiedElsewhere ?? ownRow

  if (existingDomain) {
    throw createError({
      status: 400,
      statusText: 'Domain is already registered'
    })
  }

  // Generate verification token
  const verificationToken = generateVerificationToken(32)

  // Check if this is the first domain for the team (make it primary)
  const existingTeamDomains = await db
    .select()
    .from(tables.domain)
    .where(eq(tables.domain.organizationId, team.id))

  const isPrimary = existingTeamDomains.length === 0

  // Create domain record
  const [domain] = await db
    .insert(tables.domain)
    .values({
      organizationId: team.id,
      domain: body.domain,
      status: 'pending',
      verificationToken,
      isPrimary
    })
    .returning()

  setResponseStatus(event, 201)
  return domain
})
