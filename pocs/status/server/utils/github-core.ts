// Pure helpers for the status app's GitHub reads — no Nitro auto-imports, so they unit-test.
export interface GhResult<T = unknown> {
  data: T | null
  error: string | null
}

const GH_API = 'https://api.github.com'

/** Read-only GET against the GitHub REST API. Never throws; returns { data, error }. */
export async function ghGet<T = unknown>(
  path: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<GhResult<T>> {
  if (!token) return { data: null, error: 'GITHUB_TOKEN is not configured' }
  if (!path.startsWith('/')) return { data: null, error: 'GitHub path must start with /' }
  try {
    const res = await fetchImpl(`${GH_API}${path}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'crouton-status'
      }
    })
    if (!res.ok) return { data: null, error: `GitHub ${res.status} ${res.statusText}`.trim() }
    return { data: (await res.json()) as T, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** True only for a session whose email is the configured owner (fails closed). */
export function isOwnerSession(session: { user?: { email?: string | null } } | null | undefined, ownerEmail: string | undefined): boolean {
  const owner = String(ownerEmail ?? '').trim().toLowerCase()
  const email = String(session?.user?.email ?? '').trim().toLowerCase()
  return !!owner && email === owner
}
