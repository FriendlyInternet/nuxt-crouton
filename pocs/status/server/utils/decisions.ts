// Shared by GET /api/status/decisions and /api/status/apps: decisions from open + recently closed epics, plus what waits on the owner.
import type { H3Event } from 'h3'
import { ghFetch } from './github'
import { parseDecisionsLog, type Decision } from './decisions-core'
import { appFromLabels } from './totest-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
const RECENT_DAYS = 60

interface GhIssue {
  labels?: Array<{ name?: string }>
  number: number
  title: string
  html_url: string
  body: string | null
  state: string
  closed_at: string | null
  pull_request?: unknown
}

export async function listDecisions(event: H3Event) {
  const [open, closed, questions] = await Promise.all([
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=epic&state=open&per_page=100`),
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=epic&state=closed&sort=updated&direction=desc&per_page=50`),
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=status:needs-input&state=open&per_page=100`)
  ])

  const error = open.error || closed.error || questions.error
  if (open.error && closed.error) throw createError({ statusCode: 502, statusMessage: error ?? 'GitHub unavailable' })

  const cutoff = Date.now() - RECENT_DAYS * 86_400_000
  const epics = [
    ...(open.data ?? []),
    ...(closed.data ?? []).filter(i => i.closed_at && Date.parse(i.closed_at) >= cutoff)
  ].filter(i => !i.pull_request)

  const decisions: Array<Decision & { app: string | null }> = epics
    .flatMap(i => parseDecisionsLog(i.body, i.number).map(d => ({ ...d, app: appFromLabels(i.labels) })))
    .sort((a, b) => b.date.localeCompare(a.date))

  const openQuestions = (questions.data ?? [])
    .filter(i => !i.pull_request)
    .map(i => ({ number: i.number, title: i.title, url: i.html_url, app: appFromLabels(i.labels) }))

  return { data: { decisions, openQuestions }, error }
}
