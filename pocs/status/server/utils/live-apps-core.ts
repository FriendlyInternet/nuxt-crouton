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
