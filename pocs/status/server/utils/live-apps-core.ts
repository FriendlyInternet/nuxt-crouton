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

export type PreviewDecision = { gone: false, url: string } | { gone: true, pr: number } | { gone: 'none', pr: number }

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

/** Open-PR previews: 1 pulls call + 1 comments read per recently-updated open PR, so it doesn't depend on repo-wide comment volume. */
export async function loadPreviews(get: GhGet, now = Date.now()): Promise<{ data: Preview[], error: string | null }> {
  const pulls = await get<Array<{ number: number, title: string, updated_at: string }>>(`/repos/${REPO}/pulls?state=open&per_page=50`, { fresh: true })
  if (pulls.error) return { data: [], error: pulls.error }
  const cutoff = now - 14 * 86400_000
  const recent = (pulls.data ?? []).filter(p => !p.updated_at || Date.parse(p.updated_at) >= cutoff)
  const errors: string[] = []
  const perPr = await Promise.all(recent.map(async (p) => {
    const r = await get<Array<{ body?: string }>>(`/repos/${REPO}/issues/${p.number}/comments?per_page=100`)
    if (r.error) { errors.push(`#${p.number}: ${r.error}`); return [] }
    let comments = r.data ?? []
    // A busy PR has more than one page: the sticky deploy comment is old, so read the newest page too.
    if (comments.length === 100) {
      const last = await get<Array<{ body?: string }>>(`/repos/${REPO}/issues/${p.number}/comments?per_page=100&page=2`)
      if (!last.error) comments = [...comments, ...(last.data ?? [])]
    }
    const seen = new Set<string>()
    return comments.flatMap((c): Preview[] => {
      const parsed = parseDeployComment(c.body)
      if (!parsed || seen.has(parsed.app)) return []
      seen.add(parsed.app)
      return [{ app: parsed.app, pr: p.number, title: p.title, updatedAt: p.updated_at, url: parsed.url }]
    })
  }))
  return { data: perPr.flat(), error: errors.length ? errors.join('; ') : null }
}

/** Resolves a `pr<N>` login from that PR's own state + comments (fresh), not the repo-wide list. */
export async function decidePrLogin(get: GhGet, app: string, key: string): Promise<PreviewDecision> {
  const pr = Number(key.slice(2))
  const info = await get<{ state?: string }>(`/repos/${REPO}/pulls/${pr}`, { fresh: true })
  if (info.data?.state === 'closed') return { gone: true, pr }
  const comments: Array<{ body?: string }> = []
  for (let page = 1; page <= 3; page++) {
    const r = await get<Array<{ body?: string }>>(`/repos/${REPO}/issues/${pr}/comments?per_page=100&page=${page}`, { fresh: true })
    if (r.error) break
    comments.push(...(r.data ?? []))
    if ((r.data ?? []).length < 100) break
  }
  for (const c of comments) {
    const parsed = parseDeployComment(c.body)
    if (parsed?.app === app) return { gone: false, url: parsed.url }
  }
  // Only "gone" when GitHub says closed; an open (or unreadable) PR just has no build yet.
  return { gone: 'none', pr }
}

/** Page for an open PR that has no test build for the app yet. */
export function previewNoneHtml(pr: number, app: string, stagingUrl: string): string {
  const prUrl = `https://github.com/${REPO}/pull/${pr}`
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR #${pr} has no test build</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>PR #${pr} has no test build yet</h1><p>No <strong>${esc(app)}</strong> test build has been posted on this PR.</p><p><a href="${esc(prUrl)}">Open PR #${pr}</a> · <a href="${esc(stagingUrl)}">Open ${esc(app)} staging</a></p></body>`
}
