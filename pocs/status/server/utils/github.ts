// Owner-only, cached, read-only GitHub reader for the /api/status/* routes.
// Token = Worker secret GITHUB_TOKEN (repo secret STATUS_GITHUB_TOKEN, pushed by deploy-app.yml).
import type { H3Event } from 'h3'
import { ghGet, isOwnerSession, type GhResult } from './github-core'

const cachedGh = defineCachedFunction(
  async (path: string, token: string): Promise<GhResult> => {
    const result = await ghGet(path, token)
    // Throw on error so failures are not cached for 5 minutes.
    if (result.error) throw new Error(result.error)
    return result
  },
  { name: 'status-gh', maxAge: 60 * 5, swr: false, getKey: (path: string) => path }
)

export function githubToken(event: H3Event): string | undefined {
  const env = (event.context as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env
  return env?.GITHUB_TOKEN || process.env.GITHUB_TOKEN
}

/**
 * Where a GitHub read gets its token: the request (`GITHUB_TOKEN` from its Worker env), or a token
 * worked out once by a caller with no request — the clock's card sync (#4234).
 */
export type GhSource = H3Event | { token: string | undefined }

const tokenOf = (s: GhSource): string | undefined =>
  ('token' in s && !('context' in s)) ? s.token : githubToken(s as H3Event)

/** GET a GitHub API path (e.g. `/repos/o/r/issues`), cached ~5 min (`fresh: true` skips the cache). */
export async function ghFetch<T = unknown>(src: GhSource, path: string, opts: { fresh?: boolean } = {}): Promise<GhResult<T>> {
  const token = tokenOf(src)
  if (!token) return { data: null, error: 'GITHUB_TOKEN is not configured' }
  try {
    if (opts.fresh) return await ghGet(path, token) as GhResult<T> // bypass the cache: always live
    return (await cachedGh(path, token)) as GhResult<T>
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Throws 401 unless the caller is signed in as NUXT_STATUS_OWNER_EMAIL. Call first in every /api/status/* route. */
export async function requireStatusOwner(event: H3Event): Promise<void> {
  const session = await useServerAuth(event).api.getSession({ headers: event.headers }).catch(() => null)
  if (!isOwnerSession(session, useRuntimeConfig(event).statusOwnerEmail as string)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
