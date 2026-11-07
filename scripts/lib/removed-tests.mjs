/**
 * Removed-test check (#3314) — a pipeline PR must not quietly delete a test case.
 *
 * Comparing base to head misses the #3231 shape: a test file ADDED and then DELETED inside
 * one PR is absent at both ends. So we take the union of titles over every snapshot
 * (base tree, then each commit) and subtract what the head still has.
 *
 * Pure: no git, no fs. The CLI (scripts/check-removed-tests.mjs) builds the snapshots.
 */

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

// test( / it( / describe( with optional .skip/.only/.todo/.concurrent/.sequential chains and a
// plain string-literal first argument. `.each` tables, `${}` titles and non-literal first
// arguments are deliberately ignored (a regex cannot name them reliably).
const CALL = /(?:^|[^\w.$])(?:test|it|describe)(?:\.(?:skip|only|todo|concurrent|sequential|fails|serial))*\s*\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g

/** Titles of the test cases in one source file. */
export function listTestTitles(source) {
  const out = new Set()
  for (const m of String(source || '').matchAll(CALL)) {
    const title = m[1] ?? m[2] ?? m[3]
    if (title === undefined || title.includes('${')) continue
    out.add(title)
  }
  return [...out]
}

/**
 * @param {Array<Record<string,string>>} snapshots ordered {path: source} maps (base first)
 * @param {Record<string,string>} head {path: source} at head (absent path = file gone)
 * @returns {Array<{file:string,title:string}>} titles seen earlier and missing at head
 */
export function removedTests(snapshots, head) {
  return missingAtHead(collectSeen(snapshots), head)
}

function collectSeen(snapshots) {
  const seen = new Map()
  for (const snap of snapshots) {
    for (const [file, src] of Object.entries(snap)) {
      const titles = seen.get(file) || new Set()
      for (const t of listTestTitles(src)) titles.add(t)
      seen.set(file, titles)
    }
  }
  return seen
}

function missingAtHead(seen, head) {
  const out = []
  for (const [file, titles] of seen) {
    const kept = new Set(head[file] === undefined ? [] : listTestTitles(head[file]))
    for (const title of titles) if (!kept.has(title)) out.push({ file, title })
  }
  return out
}

const normalise = (s) => s.trim().replace(/\s+/g, ' ')

/** Drop removals explained by a `Test removed: <exact title> — <non-empty why>` body line. */
export function unexplained(removed, prBody) {
  const explained = new Set()
  for (const line of String(prBody || '').split(/\r?\n/)) {
    const m = /^\s*Test removed:\s*(.+?)\s+[—–-]{1,2}\s+(\S.*)$/.exec(line)
    if (m) explained.add(normalise(m[1]))
  }
  return removed.filter((r) => !explained.has(normalise(r.title)))
}
