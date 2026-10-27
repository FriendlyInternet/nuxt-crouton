// Live app list + open-PR previews, read from GitHub (cached ~5 min by ghFetch). No build-time list.
import type { H3Event } from 'h3'
import { ghFetch } from './github'
import { liveAppFromConfig, parseDeployComment, type LiveApp, type Preview } from './live-apps-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

/** Every apps/* and pocs/* dir that has a deploy.config.json on main. */
export async function listLiveApps(event: H3Event): Promise<{ data: LiveApp[], error: string | null }> {
  const errors: string[] = []
  const found = await Promise.all(['apps', 'pocs'].map(async (dir) => {
    const list = await ghFetch<Array<{ name: string, type: string }>>(event, `/repos/${REPO}/contents/${dir}?ref=main`)
    if (list.error) { errors.push(list.error); return [] }
    const dirs = (list.data ?? []).filter(e => e.type === 'dir')
    const apps = await Promise.all(dirs.map(async (d) => {
      const r = await ghFetch<{ content?: string }>(event, `/repos/${REPO}/contents/${dir}/${d.name}/deploy.config.json?ref=main`)
      if (!r.data?.content) return null
      try {
        return liveAppFromConfig(d.name, JSON.parse(atob(r.data.content.replace(/\s/g, ''))))
      } catch { return null /* malformed config: skip */ }
    }))
    return apps.filter((a): a is LiveApp => !!a)
  }))
  return { data: found.flat().sort((a, b) => a.app.localeCompare(b.app)), error: errors.length ? errors.join('; ') : null }
}

/** One entry per open PR × app that has a deploy-staging comment. The open-PR list is always read live, so merged PRs never show. */
export async function listPreviews(event: H3Event): Promise<{ data: Preview[], error: string | null }> {
  const pulls = await ghFetch<Array<{ number: number, title: string, updated_at: string }>>(event, `/repos/${REPO}/pulls?state=open&per_page=50`, { fresh: true })
  if (pulls.error) return { data: [], error: pulls.error }
  const errors: string[] = []
  const all = await Promise.all((pulls.data ?? []).map(async (p) => {
    const c = await ghFetch<Array<{ body?: string }>>(event, `/repos/${REPO}/issues/${p.number}/comments?per_page=100`)
    if (c.error) { errors.push(c.error); return [] }
    return (c.data ?? []).flatMap((x) => {
      const parsed = parseDeployComment(x.body)
      return parsed ? [{ app: parsed.app, pr: p.number, title: p.title, updatedAt: p.updated_at, url: parsed.url }] : []
    })
  }))
  return { data: all.flat(), error: errors.length ? errors.join('; ') : null }
}
