/**
 * POST /api/teams/[id]/domains/[domainId]/verify
 *
 * Verify domain ownership via DNS TXT record.
 * Uses Cloudflare's DNS over HTTPS API for DNS lookup.
 * Requires team owner role.
 */
import { requireTeamOwner } from '../../../../../utils/team'
import { useDB, tables, eq, and } from '../../../../../utils/database'

export default defineEventHandler(async (event) => {
  const domainId = getRouterParam(event, 'domainId')
  if (!domainId) {
    throw createError({
      status: 400,
      statusText: 'Domain ID is required'
    })
  }

  const { team } = await requireTeamOwner(event)

  const db = useDB()

  // Get the domain record
  const domain = await db
    .select()
    .from(tables.domain)
    .where(and(eq(tables.domain.id, domainId), eq(tables.domain.organizationId, team.id)))
    .get()

  if (!domain) {
    throw createError({
      status: 404,
      statusText: 'Domain not found'
    })
  }

  // Check DNS TXT record
  const txtRecordName = `_crouton-verification.${domain.domain}`

  try {
    // Use Cloudflare's DNS over HTTPS API for DNS lookup
    const dnsResponse = await $fetch<{
      Status: number
      Answer?: Array<{ data: string }>
    }>(`https://cloudflare-dns.com/dns-query?name=${txtRecordName}&type=TXT`, {
      headers: {
        Accept: 'application/dns-json'
      }
    })

    if (dnsResponse.Status !== 0 || !dnsResponse.Answer) {
      // DNS lookup failed or no TXT records found
      await db
        .update(tables.domain)
        .set({ status: 'failed' })
        .where(eq(tables.domain.id, domainId))

      return {
        verified: false,
        message: 'No TXT record found. Please add the DNS record and try again.',
        expectedRecord: {
          type: 'TXT',
          name: txtRecordName,
          value: domain.verificationToken
        }
      }
    }

    // Check if any TXT record contains the verification token
    const verified = dnsResponse.Answer.some((record) => {
      // DNS TXT records are often quoted, so strip quotes
      const recordValue = record.data.replace(/^"|"$/g, '')
      return recordValue === domain.verificationToken
    })

    if (verified) {
      // First verified claim wins; the partial unique index backs this up.
      const taken = await db
        .select()
        .from(tables.domain)
        .where(and(eq(tables.domain.domain, domain.domain), eq(tables.domain.status, 'verified')))
        .get()
      if (taken && taken.id !== domainId) {
        return { verified: false, message: 'Domain is already verified by another team.' }
      }
      await db
        .update(tables.domain)
        .set({ status: 'verified', verifiedAt: new Date() })
        .where(eq(tables.domain.id, domainId))

      return {
        verified: true,
        message: 'Domain verified successfully!'
      }
    }

    // Token not found in any record
    await db
      .update(tables.domain)
      .set({ status: 'failed' })
      .where(eq(tables.domain.id, domainId))

    return {
      verified: false,
      message: 'TXT record found but verification token does not match.',
      expectedRecord: {
        type: 'TXT',
        name: txtRecordName,
        value: domain.verificationToken
      }
    }
  } catch (error) {
    console.error('DNS verification error:', error)

    return {
      verified: false,
      message: 'Failed to perform DNS lookup. Please try again later.',
      expectedRecord: {
        type: 'TXT',
        name: txtRecordName,
        value: domain.verificationToken
      }
    }
  }
})
