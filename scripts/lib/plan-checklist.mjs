/**
 * Parser for the plan's `### Test` checklist (#3194, epic #3193). One line per check:
 *
 *   - [ ] T1 — <what it proves> — Run: `<command>`
 *   - [ ] T2 — <what it proves> — Manual: <why a person must look>
 *
 * A plan with nothing runnable says so with a single `- [ ] T0 — no runnable test — Manual: <why>` line.
 * Pure: text in, { items, errors } out. IDs are `T<number>` and unique; order is kept as written.
 *
 * Reverse link: a test names the line it proves with a `// covers: T1, T3` comment on the line above.
 * `findCovers` reads those IDs; `coverageGaps` reports `Run:` lines that run a test file but no test
 * covers (`untested`), and covers IDs the checklist does not have (`unknown`). Report only.
 */
const LINE = /^\s*(?:[-*]|\d+\.)\s+(.*)$/
const FORMAT = '- [ ] T1 — <what> — Run: `cmd` | Manual: <why>'

function parseLine(b, n) {
  const m = b.match(/^\[[ xX]\]\s+(T\d+)\s+[—–-]+\s+(.*)$/)
  if (!m) return { error: `${n}: must start with "[ ] T<n> —"` }
  const id = m[1]
  const kind = m[2].match(/^(.*?)\s+[—–-]+\s+\**(Run|Manual)\**:\**\s*(.*)$/i)
  if (!kind || !kind[1].trim()) return { error: `${n} (${id}): needs "<what> — Run: \`cmd\`" or "<what> — Manual: <why>"` }
  const type = kind[2].toLowerCase()
  let detail = kind[3].trim()
  if (type === 'run') {
    const c = detail.match(/^`([^`]+)`\s*$/)
    if (!c) return { error: `${n} (${id}): Run needs exactly one command in backticks` }
    detail = c[1].trim()
  } else if (!detail) return { error: `${n} (${id}): Manual needs a reason` }
  return { item: { id, what: kind[1].replace(/\*\*/g, '').trim(), type, detail } }
}

export function parseChecklist(text) {
  const errors = []
  const items = []
  const lines = String(text || '').split('\n')
  for (const l of lines) {
    if (l.trim() && !LINE.test(l)) errors.push(`non-bullet line "${l.trim().slice(0, 40)}" needs "Run:" or "Manual:"`)
  }
  const bullets = lines.map((l) => l.match(LINE)).filter(Boolean).map((m) => m[1])
  if (!bullets.length) return { items, errors: [`Test must be a checklist: ${FORMAT}`, ...errors] }
  const seen = new Set()
  bullets.forEach((b, i) => {
    const n = `test line ${i + 1}`
    const { item, error } = parseLine(b, n)
    if (error) { errors.push(error); return }
    if (seen.has(item.id)) errors.push(`${n}: duplicate id ${item.id}`)
    seen.add(item.id)
    if (Number(item.id.slice(1)) === 0 && (bullets.length > 1 || item.type !== 'manual')) {
      errors.push(`${n}: T0 (no runnable test) must be the only line and use Manual:`)
    }
    items.push(item)
  })
  return { items, errors }
}

export function findCovers(text) {
  const ids = new Set()
  for (const m of String(text || '').matchAll(/\/\/\s*covers:\s*([^\n]*)/gi)) {
    for (const id of m[1].match(/\bT\d+\b/g) || []) ids.add(id)
  }
  return [...ids]
}

const TEST_FILE = /\S+\.(test|spec)\.[cm]?[jt]sx?\b/

export function coverageGaps(items, coversIds) {
  const covered = new Set(coversIds)
  const known = new Set(items.map((i) => i.id))
  const untested = items.filter((i) => i.type === 'run' && TEST_FILE.test(i.detail) && !covered.has(i.id)).map((i) => i.id)
  const unknown = [...covered].filter((id) => !known.has(id))
  return { untested, unknown }
}
