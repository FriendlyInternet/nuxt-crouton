/**
 * Resolve a Notion token from either an accountId or inline token.
 * Reuses the triage token resolver for connected accounts.
 */
export async function resolveNotionToken(options: {
  accountId?: string
  notionToken?: string
  teamId: string
}): Promise<string> {
  const { accountId, notionToken, teamId } = options

  if (accountId) {
    // resolveAccountToken is from crouton-triage server utils (auto-imported by Nitro)
    return resolveAccountToken(accountId, teamId)
  }

  if (notionToken) {
    return notionToken
  }

  throw createError({ status: 400, statusText: 'Either accountId or notionToken is required' })
}
