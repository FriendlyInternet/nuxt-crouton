// Shared by GET /api/status/totest and /api/status/apps.
// To-test items: — things waiting for the owner to try, with link + steps.
// Primary: epics labelled status:to-test. Fallback: merged PRs touching an app that carry a
// "How to test" section and have no owner "ok" reply.
import type { H3Event } from 'h3'
import { ghFetch } from './github'
import { appFromLabels, appFromFiles, extractTargetPath, isGithubOnly, extractHowToTest, extractSteps, firstParagraph, hasOwnerOk, type ToTestItem } from './totest-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
const OWNER_LOGIN = 'pmcp'

interface GhIssue { labels?: Array<{ name?: string }>, number: number, title: string, body: string | null, html_url: string, pull_request?: unknown }
interface GhPull { number: number, title: string, body: string | null, html_url: string, merged_at: string | null }

async function stagingUrl(event: H3Event, app: string | null): Promise<string | null> {
  if (!app) return null
  for (const dir of ['apps', 'pocs']) {
    const r = await ghFetch<{ content?: string }>(event, `/repos/${REPO}/contents/${dir}/${app}/deploy.config.json`)
    if (r.data?.content) {
      try {
        return JSON.parse(atob(r.data.content.replace(/\s/g, ''))).stagingUrl ?? null
      } catch { /* malformed config: no URL */ }
    }
  }
  return null
}

export type ToTestResult = { data: Array<ToTestItem & { stagingUrl: string | null, mergedAt?: string | null }>, error: string | null }

export async function listToTest(event: H3Event): Promise<ToTestResult> {
  const items: Array<ToTestItem & { stagingUrl: string | null, mergedAt?: string | null }> = []
  const errors: string[] = []

  const epics = await ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=status:to-test&state=all&per_page=50`)
  if (epics.error) errors.push(epics.error)
  for (const i of (epics.data ?? []).filter(x => !x.pull_request)) {
    const section = extractHowToTest(i.body)
    const app = appFromLabels(i.labels)
    const url = await stagingUrl(event, app)
    const steps = extractSteps(section)
    items.push({
      kind: 'epic', number: i.number, title: i.title, url: i.html_url, app,
      what: firstParagraph(i.body), steps, to: extractTargetPath(steps, url), stagingUrl: url
    })
  }

  const pulls = await ghFetch<GhPull[]>(event, `/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)
  if (pulls.error) errors.push(pulls.error)
  for (const p of (pulls.data ?? []).filter(x => x.merged_at)) {
    const section = extractHowToTest(p.body)
    if (!section) continue
    const [files, comments] = await Promise.all([
      ghFetch<Array<{ filename: string }>>(event, `/repos/${REPO}/pulls/${p.number}/files?per_page=100`),
      ghFetch<Array<{ body?: string, user?: { login?: string } }>>(event, `/repos/${REPO}/issues/${p.number}/comments?per_page=100`)
    ])
    const app = appFromFiles((files.data ?? []).map(f => f.filename))
    const steps = extractSteps(section)
    if (!app || hasOwnerOk(comments.data ?? [], OWNER_LOGIN) || isGithubOnly(steps)) continue
    const url = await stagingUrl(event, app)
    items.push({
      kind: 'pr', number: p.number, title: p.title, url: p.html_url, app,
      what: firstParagraph(p.body), steps, to: extractTargetPath(steps, url), stagingUrl: url, mergedAt: p.merged_at
    })
  }

  return { data: items, error: errors.length ? errors.join('; ') : null }
}
