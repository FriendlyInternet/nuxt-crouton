// Pure classifier for the Now / Next / Waiting view — no Nitro auto-imports, so it unit-tests.
// Input is raw GitHub payloads; output is the three lists. No state of its own.
export interface GhLabel { name?: string }
export interface GhPr {
  number: number, title: string, html_url: string, draft?: boolean, body?: string | null
  head?: { ref?: string }, base?: { ref?: string }, labels?: GhLabel[], user?: { login?: string, type?: string }
}
export interface GhIssueLite { number: number, title: string, html_url: string, labels?: GhLabel[], pull_request?: unknown }
export interface GhRun { name?: string, display_title?: string, status?: string, html_url?: string }
export interface GhComment { body?: string | null }

export interface NowItem { number: number, kind: 'pr' | 'issue', title: string, url: string, step: string }
export interface NextItem { number: number, title: string, url: string, epic: number | null }
export interface WaitingItem { number: number, kind: 'pr' | 'issue', title: string, url: string, reason: string }
export interface NowResult { now: NowItem[], next: NextItem[], waiting: WaitingItem[] }

export interface NowInput {
  pulls: GhPr[]
  workIssues: GhIssueLite[]
  blockedIssues: GhIssueLite[]
  runs: GhRun[]
  /** Comment bodies (oldest first) keyed by issue/PR number — only fetched for held candidates. */
  comments: Record<number, GhComment[]>
}

const hasLabel = (x: { labels?: GhLabel[] }, name: string) => (x.labels ?? []).some(l => l.name === name)
const isPipelinePr = (p: GhPr) => {
  const ref = p.head?.ref ?? ''
  const bot = p.user?.type === 'Bot' || /\[bot\]$|^nuxt-harness$/.test(p.user?.login ?? '')
  return bot && (ref.startsWith('work-') || ref.startsWith('epic/'))
}
const FINAL_HOLD = /held for you|rejected twice/i

/** One-line reason from a hold comment: the "## … Blocked — X" heading, else the first prose line. */
export function holdReason(body: string | null | undefined): string {
  const lines = String(body ?? '').split(/\r?\n/).map(l => l.trim())
  const heading = lines.find(l => /^#{1,6}\s+.*blocked/i.test(l))
  if (heading) return heading.replace(/^#{1,6}\s+/, '').replace(/^\S*\s*Blocked\s*[—–:-]\s*/i, '').trim()
  const prose = lines.find(l => l && !l.startsWith('>') && !l.startsWith('<') && !l.startsWith('**Needs'))
  return (prose ?? '').replace(/^#{1,6}\s+/, '').slice(0, 200)
}

/** Issue numbers a PR works on: "Closes #N" in the body, or `work-N…` in the head ref. */
function linkedIssues(p: GhPr): number[] {
  const out = new Set<number>()
  for (const m of String(p.body ?? '').matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)/gi)) out.add(Number(m[1]))
  const h = /^work-(?:issue-)?(\d+)/.exec(p.head?.ref ?? '')
  if (h) out.add(Number(h[1]))
  return [...out]
}

export function classifyNow(input: NowInput): NowResult {
  const latest = (n: number) => (input.comments[n] ?? []).at(-1)?.body ?? ''
  const waiting: WaitingItem[] = []
  const heldNumbers = new Set<number>()

  for (const i of input.blockedIssues.filter(x => !x.pull_request)) {
    heldNumbers.add(i.number)
    waiting.push({ number: i.number, kind: 'issue', title: i.title, url: i.html_url, reason: holdReason(latest(i.number)) || 'Blocked' })
  }
  for (const p of input.pulls) {
    const verdict = latest(p.number)
    if (hasLabel(p, 'status:blocked') || FINAL_HOLD.test(verdict)) {
      heldNumbers.add(p.number)
      waiting.push({ number: p.number, kind: 'pr', title: p.title, url: p.html_url, reason: holdReason(verdict) || 'Held for you' })
    }
  }

  const now: NowItem[] = []
  const active = new Set<number>()
  for (const r of input.runs) {
    const n = Number(/#(\d+)/.exec(r.display_title ?? r.name ?? '')?.[1])
    if (!n || active.has(n)) continue
    active.add(n)
    const mode = /·\s*(\w+)/.exec(r.display_title ?? r.name ?? '')?.[1] ?? 'build'
    now.push({ number: n, kind: 'issue', title: r.display_title ?? r.name ?? `#${n}`, url: r.html_url ?? '', step: mode === 'plan' ? 'Planning' : 'Building' })
  }
  const withPr = new Set<number>()
  for (const p of input.pulls.filter(isPipelinePr)) {
    for (const n of linkedIssues(p)) withPr.add(n)
    if (heldNumbers.has(p.number)) continue
    now.push({ number: p.number, kind: 'pr', title: p.title, url: p.html_url, step: p.draft ? 'Draft — in a fix round' : 'In review / CI' })
  }

  const next = input.workIssues
    .filter(i => !i.pull_request && !hasLabel(i, 'status:blocked') && !heldNumbers.has(i.number) && !withPr.has(i.number) && !active.has(i.number))
    .map(i => ({ number: i.number, title: i.title, url: i.html_url, epic: null as number | null }))
    .sort((a, b) => a.number - b.number)

  return { now: now.filter(n => !(n.kind === 'issue' && heldNumbers.has(n.number))), next, waiting }
}
