/**
 * Pure helpers behind velo's "Assistants IA" page (#4098).
 *
 * The page lists the signed-in person's own OAuth consents (one per connected AI
 * app — Claude, ChatGPT, …) from better-auth's built-in endpoints under
 * `/api/auth/oauth2/*`, and "Révoquer" deletes exactly one consent row. No Nuxt
 * imports here, so the logic is unit-tested without booting Nuxt
 * (`apps/velo/tests/claudeConnections.test.ts`).
 */

export interface OAuthConsentRow {
  id: string
  clientId: string
  scopes?: string[]
  createdAt: string | Date
}

export interface ClaudeConnection {
  id: string
  clientId: string
  name: string
  createdAt: string
}

export type Fetcher = (
  url: string,
  opts?: { method?: string, body?: unknown, query?: Record<string, string> }
) => Promise<unknown>

/** One row per consent; name falls back to the clientId; ISO date; newest first. */
export function toClaudeConnections(
  consents: OAuthConsentRow[],
  names: Record<string, string | undefined>
): ClaudeConnection[] {
  return (consents ?? [])
    .map(c => ({
      id: c.id,
      clientId: c.clientId,
      name: names[c.clientId] || c.clientId,
      createdAt: new Date(c.createdAt).toISOString()
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Looks up each distinct client's display name via
 * `GET /api/auth/oauth2/public-client?client_id=…`. A failed or nameless lookup
 * leaves that id out, so `toClaudeConnections` shows the clientId instead.
 */
export async function fetchClientNames(
  clientIds: string[],
  fetcher: Fetcher
): Promise<Record<string, string | undefined>> {
  const names: Record<string, string | undefined> = {}
  const distinct = [...new Set(clientIds.filter(Boolean))]
  await Promise.all(distinct.map(async (clientId) => {
    try {
      const client = await fetcher('/api/auth/oauth2/public-client', { query: { client_id: clientId } }) as { client_name?: unknown } | null
      if (client && typeof client.client_name === 'string' && client.client_name) {
        names[clientId] = client.client_name
      }
    }
    catch {
      // unknown/disabled client — fall back to the clientId
    }
  }))
  return names
}

/**
 * Deletes one consent (`POST /api/auth/oauth2/delete-consent { id }`) and returns
 * the rows without it. On failure it rethrows and the caller keeps its rows.
 */
export async function revokeClaudeConnection(
  rows: ClaudeConnection[],
  id: string,
  fetcher: Fetcher
): Promise<ClaudeConnection[]> {
  await fetcher('/api/auth/oauth2/delete-consent', { method: 'POST', body: { id } })
  return rows.filter(r => r.id !== id)
}
