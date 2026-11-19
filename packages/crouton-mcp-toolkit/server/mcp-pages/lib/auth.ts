/**
 * Pages-token access (#3982) — Rule A, token side.
 *
 * A pages token is a scoped access token with `resourceType: 'mcp'`,
 * `resourceId: 'mcp-pages'` and `role: 'admin'`, minted only by a team admin.
 * The team comes from the TOKEN (its organizationId), never from a tool argument.
 * A general `mcp-toolkit` token, a member token or any other token is refused.
 */

export interface PagesAccess {
  teamId: string
  tokenId: string
}

export interface ScopedTokenRecord {
  id: string
  organizationId: string
  resourceType: string
  resourceId: string
  role: string
}

export type ValidateScopedToken = (token: string) => Promise<ScopedTokenRecord | null>

const PAGES_TOKEN_RESOURCE_ID = 'mcp-pages'

const defaultValidate: ValidateScopedToken = async (token) => {
  const { validateScopedToken } = await import('@fyit/crouton-auth/server/utils/scoped-access')
  return validateScopedToken(token)
}

export async function resolvePagesAccess(
  token: string | null | undefined,
  validate: ValidateScopedToken = defaultValidate
): Promise<PagesAccess | null> {
  if (!token) return null
  const record = await validate(token)
  if (!record) return null
  if (record.resourceType !== 'mcp' || record.resourceId !== PAGES_TOKEN_RESOURCE_ID || record.role !== 'admin') {
    return null
  }
  return { teamId: record.organizationId, tokenId: record.id }
}

/** The token from `?token=` or `Authorization: Bearer …`. */
export function pagesTokenFrom(query: Record<string, unknown>, authorization: string | null | undefined): string | null {
  const q = query.token
  if (typeof q === 'string' && q) return q
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7) || null
  return null
}
