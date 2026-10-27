// Pure helpers for the live app list + PR previews — no Nitro auto-imports, so they unit-test.
export interface PreviewComment { app: string, url: string }
export interface Preview { app: string, pr: number, title: string, updatedAt: string, url: string }
export interface LiveApp { app: string, stagingUrl: string | null, hasSignIn: boolean }

/** Parses the sticky `<!-- deploy-staging:<app> -->` comment deploy-app.yml posts on a PR. */
export function parseDeployComment(body: string | null | undefined): PreviewComment | null {
  const m = /<!--\s*deploy-staging:([a-z0-9-]+)\s*-->/.exec(body ?? '')
  if (!m) return null
  const u = /preview for this PR:\s*(https:\/\/[^\s<>)]+)/.exec(body ?? '')
  return u ? { app: m[1]!, url: u[1]! } : null
}

/** Resolves a `pr<N>` key to that PR's preview URL for the app, or null. */
export function resolvePreviewUrl(previews: Preview[], app: string, key: string): string | null {
  const m = /^pr(\d+)$/.exec(key)
  if (!m) return null
  return previews.find(p => p.app === app && p.pr === Number(m[1]))?.url ?? null
}

/** Builds a LiveApp from a deploy.config.json body (same rules as scripts/gen-app-urls.mjs). */
export function liveAppFromConfig(app: string, cfg: { stagingUrl?: string, reviewLogin?: boolean }): LiveApp {
  return { app, stagingUrl: cfg.stagingUrl ?? null, hasSignIn: cfg.reviewLogin !== false }
}

export type PreviewDecision = { gone: false, url: string } | { gone: true, pr: number }

/** Decides a `pr<N>` login: redirect to the preview, or show the "build is gone" page. */
export function decidePreview(openPreviews: Preview[], app: string, key: string): PreviewDecision {
  const url = resolvePreviewUrl(openPreviews, app, key)
  return url ? { gone: false, url } : { gone: true, pr: Number(key.slice(2)) }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Readable replacement for a 404 when the PR was merged/closed and its test build is torn down. */
export function previewGoneHtml(pr: number, app: string, stagingUrl: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR #${pr} is gone</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>PR #${pr} was merged or closed</h1><p>Its test build for <strong>${esc(app)}</strong> is gone.</p><p><a href="${esc(stagingUrl)}">Open ${esc(app)} staging</a></p></body>`
}

export type GhGet = <T>(path: string, opts?: { fresh?: boolean }) => Promise<{ data: T | null, error: string | null }>

const REPO = 'FriendlyInternet/nuxt-crouton'
const CONFIG_RE = /^(?:apps|pocs)\/([^/]+)\/deploy\.config\.json$/

/** Config file paths (apps/* and pocs/*) from a recursive git tree listing. */
export function configPathsFromTree(tree: Array<{ path: string, type: string }>): Array<{ app: string, path: string }> {
  return tree.flatMap((e) => {
    const m = e.type === 'blob' ? CONFIG_RE.exec(e.path) : null
    return m ? [{ app: m[1]!, path: e.path }] : []
  })
}

/** Preview entries from repo-wide issue comments, kept only for the given open PRs. */
export function previewsFromComments(comments: Array<{ body?: string, issue_url?: string }>, open: Map<number, { title: string, updated_at: string }>): Preview[] {
  const seen = new Set<string>()
  return comments.flatMap((c) => {
    const pr = Number(/\/issues\/(\d+)$/.exec(c.issue_url ?? '')?.[1])
    const meta = open.get(pr)
    const parsed = meta ? parseDeployComment(c.body) : null
    if (!meta || !parsed || seen.has(`${parsed.app}#${pr}`)) return []
    seen.add(`${parsed.app}#${pr}`)
    return [{ app: parsed.app, pr, title: meta.title, updatedAt: meta.updated_at, url: parsed.url }]
  })
}

/** Every app with a deploy.config.json on main: 1 tree call + 1 read per config. Failed reads go into `error`. */
export async function loadLiveApps(get: GhGet): Promise<{ data: LiveApp[], error: string | null }> {
  const tree = await get<{ tree: Array<{ path: string, type: string }>, truncated?: boolean }>(`/repos/${REPO}/git/trees/main?recursive=1`)
  if (tree.error || !tree.data) return { data: [], error: tree.error ?? 'empty git tree' }
  const errors: string[] = tree.data.truncated ? ['git tree truncated'] : []
  const apps = await Promise.all(configPathsFromTree(tree.data.tree).map(async ({ app, path }) => {
    const r = await get<{ content?: string }>(`/repos/${REPO}/contents/${path}?ref=main`)
    if (r.error || !r.data?.content) { errors.push(`${path}: ${r.error ?? 'no content'}`); return null }
    try {
      return liveAppFromConfig(app, JSON.parse(atob(r.data.content.replace(/\s/g, ''))))
    } catch { errors.push(`${path}: malformed JSON`); return null }
  }))
  return { data: apps.filter((a): a is LiveApp => !!a).sort((a, b) => a.app.localeCompare(b.app)), error: errors.length ? errors.join('; ') : null }
}

/** Open-PR previews: 1 pulls call + ≤3 repo-wide comment pages (most recently updated first — the sticky deploy comment is edited on each deploy), not one call per PR. */
export async function loadPreviews(get: GhGet, now = Date.now()): Promise<{ data: Preview[], error: string | null }> {
  const pulls = await get<Array<{ number: number, title: string, updated_at: string }>>(`/repos/${REPO}/pulls?state=open&per_page=50`, { fresh: true })
  if (pulls.error) return { data: [], error: pulls.error }
  const open = new Map((pulls.data ?? []).map(p => [p.number, p]))
  const since = new Date(now - 14 * 86400_000).toISOString()
  const comments: Array<{ body?: string, issue_url?: string }> = []
  for (let page = 1; page <= 3; page++) {
    const r = await get<Array<{ body?: string, issue_url?: string }>>(`/repos/${REPO}/issues/comments?since=${since}&sort=updated&direction=desc&per_page=100&page=${page}`)
    if (r.error) return { data: previewsFromComments(comments, open), error: r.error }
    comments.push(...(r.data ?? []))
    if ((r.data ?? []).length < 100) break
  }
  return { data: previewsFromComments(comments, open), error: null }
}
