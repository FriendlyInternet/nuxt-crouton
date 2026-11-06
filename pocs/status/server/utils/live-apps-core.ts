// Pure helpers for the live app list + PR previews — no Nitro auto-imports, so they unit-test.
export interface PreviewComment { app: string, url: string }
export interface Preview { app: string, pr: number, title: string, updatedAt: string, url: string }
export interface LiveApp { app: string, stagingUrl: string | null, hasSignIn: boolean, dir?: string }

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

/** "Open staging" link, or nothing when the app has no staging address (never `href=""`). */
function stagingLink(app: string, stagingUrl: string, before: string, after: string): string {
  return stagingUrl ? `${before}<a href="${esc(stagingUrl)}">Open ${esc(app)} staging</a>${after}` : ''
}

/** 404 page for the `main` sign-in of an app that only has PR test builds. */
export function noStagingHtml(app: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No staging address</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>No staging address</h1><p><strong>${esc(app)}</strong> has no staging address — it only has PR test builds. Open it from the PR's preview link.</p></body>`
}

/** 404 page for the `main` sign-in of an app that is not on main yet (only its PR previews exist). */
export function notOnMainHtml(app: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not on main yet</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>Not on main yet</h1><p><strong>${esc(app)}</strong> is not on main yet — it only has PR test builds. Open it from a PR's preview link.</p></body>`
}

export interface LoginTarget { stagingUrl: string, hasSignIn: boolean }
export type LoginPlan =
  | { kind: 'page', status: number, html: string }
  | { kind: 'redirect', base: string, signIn: boolean }

/**
 * Decides what the sign-in route does. A PR key uses the PR preview as its base, and an app missing
 * from the list (not on main yet) defaults to sign-in ON; only `main` needs a staging address.
 * `decision` is the resolved PR preview (required for `pr<N>` keys).
 */
export function loginPlan(
  target: LoginTarget | null, app: string, key: string, hasSecret: boolean, decision?: PreviewDecision,
): LoginPlan {
  const t = target ?? { stagingUrl: '', hasSignIn: true }
  let base = t.stagingUrl
  if (key === 'main') {
    if (!target) return { kind: 'page', status: 404, html: notOnMainHtml(app) }
    if (!t.stagingUrl) return { kind: 'page', status: 404, html: noStagingHtml(app) }
  } else {
    if (!decision) throw new Error('decision required for a PR key')
    if (decision.gone === 'none') return { kind: 'page', status: 404, html: previewNoneHtml(decision.pr, app, t.stagingUrl) }
    if (decision.gone) return { kind: 'page', status: 410, html: previewGoneHtml(decision.pr, app, t.stagingUrl) }
    base = decision.url
  }
  return { kind: 'redirect', base, signIn: t.hasSignIn && hasSecret }
}

/** Readable replacement for a 404 when the PR was merged/closed and its test build is torn down. */
export function previewGoneHtml(pr: number, app: string, stagingUrl: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR #${pr} is gone</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>PR #${pr} was merged or closed</h1><p>Its test build for <strong>${esc(app)}</strong> is gone.</p>${stagingLink(app, stagingUrl, '<p>', '</p>')}</body>`
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
  const apps = await Promise.all(configPathsFromTree(tree.data.tree).map(async ({ app, path }): Promise<LiveApp | null> => {
    const r = await get<{ content?: string }>(`/repos/${REPO}/contents/${path}?ref=main`)
    if (r.error || !r.data?.content) { errors.push(`${path}: ${r.error ?? 'no content'}`); return null }
    try {
      return { ...liveAppFromConfig(app, JSON.parse(atob(r.data.content.replace(/\s/g, '')))), dir: path.slice(0, path.lastIndexOf('/')) }
    } catch { errors.push(`${path}: malformed JSON`); return null }
  }))
  return { data: apps.filter((a): a is LiveApp => !!a).sort((a, b) => a.app.localeCompare(b.app)), error: errors.length ? errors.join('; ') : null }
}

/** Open-PR previews: 1 pulls call + one read of each open PR's own comments (parallel; ≤3 pages each). */
export async function loadPreviews(get: GhGet): Promise<{ data: Preview[], error: string | null }> {
  const pulls = await get<Array<{ number: number, title: string, updated_at: string }>>(`/repos/${REPO}/pulls?state=open&per_page=50`, { fresh: true })
  if (pulls.error) return { data: [], error: pulls.error }
  const errors: string[] = []
  const lists = await Promise.all((pulls.data ?? []).map(async (p) => {
    const found: Preview[] = []
    for (let page = 1; page <= 3; page++) {
      const r = await get<Array<{ body?: string }>>(`/repos/${REPO}/issues/${p.number}/comments?per_page=100&page=${page}`, { fresh: true })
      if (r.error) { errors.push(`#${p.number}: ${r.error}`); break }
      for (const c of r.data ?? []) {
        const parsed = parseDeployComment(c.body)
        if (parsed && !found.some(f => f.app === parsed.app)) found.push({ app: parsed.app, pr: p.number, title: p.title, updatedAt: p.updated_at, url: parsed.url })
      }
      if ((r.data ?? []).length < 100) break
    }
    return found
  }))
  return { data: lists.flat(), error: errors.length ? errors.join('; ') : null }
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
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR #${pr} has no test build</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>PR #${pr} has no test build yet</h1><p>No <strong>${esc(app)}</strong> test build has been posted on this PR.</p><p><a href="${esc(prUrl)}">Open PR #${pr}</a>${stagingLink(app, stagingUrl, ' · ', '')}</p></body>`
}
