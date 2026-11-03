// GET /api/status/decisions — decisions from open + recently closed epics, plus what waits on the owner.
import { parseDecisionsLog, type Decision } from '../../utils/decisions-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
const RECENT_DAYS = 60

interface GhIssue {
  number: number
  title: string
  html_url: string
  body: string | null
  state: string
  closed_at: string | null
  pull_request?: unknown
}

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)

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

  const decisions: Decision[] = epics
    .flatMap(i => parseDecisionsLog(i.body, i.number))
    .sort((a, b) => b.date.localeCompare(a.date))

  const openQuestions = (questions.data ?? [])
    .filter(i => !i.pull_request)
    .map(i => ({ number: i.number, title: i.title, url: i.html_url }))

  return { data: { decisions, openQuestions }, error }
})
