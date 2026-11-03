// Pure parser for epic "Decisions log" sections — no Nitro auto-imports, so it unit-tests.
export interface Decision {
  date: string
  epic: number
  decision: string
  why: string
  rejected: string
}

const HEADING = /^#{1,6}\s+.*\bdecisions?(\s+log)?\b/i
const ANY_HEADING = /^#{1,6}\s+/
// `- 2026-10-24 — text` or `- [2026-07-02] text`
const LINE = /^\s*[-*]\s+\[?(\d{4}-\d{2}-\d{2})\]?\s*[—–:-]?\s*(.+)$/

/** Extract dated decision lines under any "Decisions"/"Decisions log" heading of an epic body. */
export function parseDecisionsLog(body: string | null | undefined, epic: number): Decision[] {
  const out: Decision[] = []
  let inSection = false
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    if (ANY_HEADING.test(raw)) {
      inSection = HEADING.test(raw)
      continue
    }
    if (!inSection) continue
    const m = LINE.exec(raw)
    if (!m) continue
    const [date, rest] = [m[1]!, m[2]!.trim()]
    const parts = rest.split(/\s+(?:→|->)\s+/)
    let rejected = ''
    const clean = (s: string) => {
      const r = /\(?\s*Rejected:\s*([\s\S]*?)\)?$/i.exec(s)
      if (!r) return s.trim()
      rejected = [rejected, r[1]!.replace(/;\s*Rejected:\s*/gi, '; ').trim()].filter(Boolean).join('; ')
      return s.slice(0, r.index).trim()
    }
    const cleaned = parts.map(clean)
    out.push({
      date,
      epic,
      decision: cleaned[0] ?? '',
      why: cleaned.slice(1).filter(Boolean).join(' → '),
      rejected
    })
  }
  return out
}
