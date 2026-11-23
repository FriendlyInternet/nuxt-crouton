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
export interface ChangelogRow { date: string, number: number, title: string, area: string, url: string }

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
