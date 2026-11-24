// Shared types + small helpers for the /apps dashboard and its tab components.

export interface ToTestItem {
  kind: 'epic' | 'pr'
  number: number
  title: string
  url: string
  app: string | null
  what: string
  steps: string[]
  to: string
  stagingUrl: string | null
  mergedAt?: string | null
}
export interface AppRow {
  app: string
  stagingUrl: string | null
  hasSignIn: boolean
  previews: Array<{ pr: number, title: string, updatedAt: string, url: string }>
}
export type AppCardRow = AppRow & { toTest: ToTestItem[] }
export interface ToTestGroup { app: string, list: ToTestItem[], stagingUrl: string | null }
export interface Decision { date: string, epic: number, decision: string, why: string, rejected: string }
export interface OpenQuestion { number: number, title: string, url: string }
/** Mirrors ChangelogRow in server/utils/changelog-core.ts. */
export interface ChangelogRow {
  date: string
  mergedAt: string
  number: number
  title: string
  area: string
  kind: 'new' | 'fix' | 'chore' | 'change'
  url: string
}

export const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')

/** One clock job's row on the Clock tab (mirrors JobStatus in server/utils/clock-status-core.ts). */
export interface ClockRow {
  workflow: string
  schedule: string
  about: string
  lastDue: string | null
  nextDue: string | null
  /** The inbox stuck check's row has only `createdAt` (it is no workflow run, so no link). */
  lastRun: { id?: number, url?: string, createdAt: string, status?: string | null, conclusion?: string | null } | null
  state: 'ok' | 'running' | 'failed' | 'missed' | 'due' | 'before-clock' | 'unknown'
  error?: string | null
}

const RED: ClockRow['state'][] = ['missed', 'failed', 'unknown']
/** Red rows (missed / failed / unknown) first, then by when they run next. */
export function sortClockRows(rows: ClockRow[]): ClockRow[] {
  const red = (r: ClockRow) => (RED.includes(r.state) ? 0 : 1)
  const next = (r: ClockRow) => (r.nextDue ? Date.parse(r.nextDue) : Infinity)
  return [...rows].sort((a, b) => red(a) - red(b) || next(a) - next(b))
}

/** A time in the owner's zone (Europe/Brussels), e.g. "Thu 19 Nov, 14:10". */
export function ownerTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

// Changelog day headers (#4352): the merge's calendar day in Europe/Brussels, like ownerTime.
const brusselsDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(d)

/** The owner's (Europe/Brussels) day of a merge: "Today", "Yesterday", else e.g. "Fri 20 Nov". */
export function dayHeader(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const key = brusselsDay(d)
  const today = brusselsDay(now)
  if (key === today) return 'Today'
  const y = new Date(`${today}T00:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  if (key === y.toISOString().slice(0, 10)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

/** Rows (newest first) grouped under day headers, keeping their order. */
export function groupByDay(rows: ChangelogRow[], now: Date = new Date()): Array<{ day: string, rows: ChangelogRow[] }> {
  const groups: Array<{ day: string, rows: ChangelogRow[] }> = []
  for (const r of rows) {
    const day = dayHeader(r.mergedAt || r.date, now)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(r)
    else groups.push({ day, rows: [r] })
  }
  return groups
}

/** One card on the Pipeline tab (mirrors BoardRow in server/utils/board-core.ts, #4349). */
export interface BoardRow {
  id: string
  number: number
  title: string
  url: string
  column: 'queued' | 'working' | 'review' | 'you' | 'test' | 'done'
  since: string | null
  checksRed: boolean
  pkg: string | null
  order: number
}

/** How long since `iso`, short: "5 min", "3 h", "2 d"; "" when unknown. */
export function shortAge(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : Number.NaN
  if (Number.isNaN(t)) return ''
  const min = Math.max(0, Math.floor((now - t) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`
}
