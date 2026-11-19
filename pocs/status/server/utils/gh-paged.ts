// Read every page of a GitHub list (#3777). `ghGet` reads one page only, and PR commit lists and
// long comment threads go past it. Always live (`fresh: true`). Any failed page — or more than
// MAX_PAGES pages — returns `{ data: null, error }`, never a partial list: a partial list would
// look like "no later reply" or "no newer commit".
import type { GhResult } from './github-core'
import { ghFetch, type GhSource } from './github'

const PER_PAGE = 100
const MAX_PAGES = 10

/**
 * `path` must already carry `per_page=100` (and a `?`). `maxPages` raises the page limit for lists
 * GitHub caps higher (a PR's files: 3000 = 30 pages, #3785).
 */
export async function ghGetAll<T = unknown>(src: GhSource, path: string, maxPages = MAX_PAGES): Promise<GhResult<T[]>> {
  const all: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const r = await ghFetch<T[]>(src, `${path}&page=${page}`, { fresh: true })
    if (r.error || !Array.isArray(r.data)) return { data: null, error: r.error ?? `GitHub returned no list for ${path}` }
    all.push(...r.data)
    if (r.data.length < PER_PAGE) return { data: all, error: null }
  }
  return { data: null, error: `more than ${maxPages} pages for ${path}` }
}
