// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageAccount } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageAccount } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const { accountId } = getRouterParams(event)
  if (!accountId) {
    throw createError({ status: 400, statusText: 'Missing account ID' })
  }
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<Partial<TriageAccount>>(event)

  return await updateTriageAccount(accountId, team.id, user.id, {
    provider: body.provider,
    label: body.label,
    providerAccountId: body.providerAccountId,
    accessToken: body.accessToken,
    accessTokenHint: body.accessTokenHint,
    refreshToken: body.refreshToken,
    tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : body.tokenExpiresAt,
    scopes: body.scopes,
    providerMetadata: body.providerMetadata,
    status: body.status,
    lastVerifiedAt: body.lastVerifiedAt ? new Date(body.lastVerifiedAt) : body.lastVerifiedAt
  })
})