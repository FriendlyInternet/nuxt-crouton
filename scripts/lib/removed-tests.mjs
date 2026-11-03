/**
 * Removed-test detection (#3314). Pure: no git, no fs.
 *
 * A base-vs-head diff cannot see a test that was added and then deleted INSIDE one PR (#3231),
 * so callers pass an ordered list of snapshots (base tree, then each commit) and we take the
 * union of titles per file, minus what survives at head.
 *
 * Known gaps, tolerated: `.each` tables, titles built from `${}`, and calls whose first
 * argument is not a string literal are ignored.
 */
const CALL = /\b(?:test|it|describe)(?:\.(?:skip|only|todo|concurrent|fails))*\s*\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g

export function listTestTitles(source) {
  const out = new Set()
  for (const m of String(source || '').matchAll(CALL)) {
    const t = m[1] ?? m[2] ?? m[3]
    if (t === undefined || t.includes('${')) continue
    out.add(t)
  }
  return [...out]
}

/** Union of test titles per file across every snapshot. */
function collectTitles(snapshots) {
  const seen = new Map()
  for (const snap of snapshots) {
    for (const [file, src] of Object.entries(snap)) {
      if (!seen.has(file)) seen.set(file, new Set())
      for (const t of listTestTitles(src)) seen.get(file).add(t)
    }
  }
  return seen
}

/** snapshots: [{path: source}, ...]; head: {path: source}. Returns [{file, title}]. */
export function removedTests(snapshots, head) {
  const seen = collectTitles(snapshots)
  const out = []
  for (const [file, titles] of seen) {
    const kept = new Set(head[file] === undefined ? [] : listTestTitles(head[file]))
    for (const title of titles) if (!kept.has(title)) out.push({ file, title })
  }
  return out
}

/** Drop removals covered by a `Test removed: <exact title> — <non-empty why>` line in the PR body. */
export function unexplained(removed, prBody) {
  const lines = String(prBody || '').split(/\r?\n/).map((l) => l.trim())
  return removed.filter(({ title }) => {
    const prefix = `Test removed: ${title} — `
    return !lines.some((l) => l.startsWith(prefix) && l.slice(prefix.length).trim() !== '')
  })
}
