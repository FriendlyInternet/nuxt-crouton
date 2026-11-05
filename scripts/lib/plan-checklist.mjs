/**
 * Parser for the plan's `### Test` checklist (#3194, epic #3193). One line per check:
 *
 *   - [ ] T1 — <what it proves> — Run: `<command>`
 *   - [ ] T2 — <what it proves> — Manual: <why a person must look>
 *
 * A plan with nothing runnable says so with a single `- [ ] T0 — no runnable test — Manual: <why>` line.
 * Pure: text in, { items, errors } out. IDs are `T<number>`, unique, and in order.
 */
const LINE = /^\s*(?:[-*]|\d+\.)\s+(.*)$/

export function parseChecklist(text) {
  const errors = []
  const items = []
  const lines = String(text || '').split('\n')
  for (const l of lines) {
    if (l.trim() && !LINE.test(l) && !/\b(Run|Manual)\b\**:/i.test(l)) errors.push(`non-bullet line "${l.trim().slice(0, 40)}" needs "Run:" or "Manual:"`)
  }
  const bullets = lines.map((l) => l.match(LINE)).filter(Boolean).map((m) => m[1])
  if (!bullets.length) return { items, errors: ['Test must be a checklist: - [ ] T1 — <what> — Run: `cmd` | Manual: <why>'] }
  const seen = new Set()
  let last = -1
  bullets.forEach((b, i) => {
    const n = `test line ${i + 1}`
    const m = b.match(/^\[[ xX]\]\s+(T\d+)\s+[—–-]+\s+(.*)$/)
    if (!m) { errors.push(`${n}: must start with "[ ] T<n> —"`); return }
    const id = m[1]
    const rest = m[2]
    const kind = rest.match(/^(.*?)\s+[—–-]+\s+\**(Run|Manual)\**:\**\s*(.*)$/i)
    if (!kind || !kind[1].trim()) { errors.push(`${n} (${id}): needs "<what> — Run: \`cmd\`" or "<what> — Manual: <why>"`); return }
    const type = kind[2].toLowerCase()
    let detail = kind[3].trim()
    if (type === 'run') {
      const c = detail.match(/^`([^`]+)`\s*$/)
      if (!c) { errors.push(`${n} (${id}): Run needs one command in backticks`); return }
      detail = c[1].trim()
    } else if (!detail) { errors.push(`${n} (${id}): Manual needs a reason`); return }
    if (seen.has(id)) errors.push(`${n}: duplicate id ${id}`)
    seen.add(id)
    const num = Number(id.slice(1))
    if (num <= last) errors.push(`${n}: ${id} is out of order`)
    last = Math.max(last, num)
    if (num === 0 && (bullets.length > 1 || type !== 'manual')) errors.push(`${n}: T0 (no runnable test) must be the only line and use Manual:`)
    items.push({ id, what: kind[1].replace(/\*\*/g, '').trim(), type, detail })
  })
  return { items, errors }
}
