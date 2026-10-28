// layer: harness
// Fix-bot guard (#2719): a CI "fix" must repair the worker's code, not delete it.
//
// On PR #2684 the worker referenced a menu group it never defined; the fix-bot turned CI green
// by deleting the reference — and with it the "See all activity" behaviour the owner asked for
// (commit e5069974, "drop stray seeAllGroup reference"). Green build, behaviour gone.
//
// Pure: takes two unified diffs (strings), returns the lines the fix removed that the worker
// added. No git, no IO — the workflow feeds it `git diff` output.
//
//   workerDiff — what the PR's own commits added   (git diff <base>...<pre-fix head>)
//   fixDiff    — what the fix-bot's commit(s) did   (git diff <pre-fix head> <fix head>)

/** Lines carrying no behaviour: blank/whitespace, or imports. Removing these is a normal fix. */
const isTrivial = line =>
  line.trim() === '' || /^\s*import\s[^;]*\sfrom\s+['"][^'"]+['"]\s*;?\s*$/.test(line) || /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/.test(line)

const HEADER_PREFIXES = ['--- ', 'diff ', 'index ', '@@']

/** Path from a `+++ ` header line, or null for /dev/null. */
const headerPath = raw => {
  const p = raw.slice(4).trim()
  return p === '/dev/null' ? null : p.replace(/^b\//, '')
}

/** Parse a unified diff into { file -> { added: string[], removed: string[] } }. */
export function parseDiff(diff) {
  const files = {}
  let current = null
  for (const raw of String(diff || '').split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = headerPath(raw)
      current = path ? (files[path] ??= { added: [], removed: [] }) : null
    } else if (current && !HEADER_PREFIXES.some(h => raw.startsWith(h))) {
      if (raw.startsWith('+')) current.added.push(raw.slice(1))
      else if (raw.startsWith('-')) current.removed.push(raw.slice(1))
    }
  }
  return files
}

/**
 * Lines the fix removed that the worker added (per file), ignoring blank lines and imports.
 * @returns {{ refuse: boolean, removed: { file: string, line: string }[] }}
 */
export function findRemovedWorkerLines(workerDiff, fixDiff) {
  const worker = parseDiff(workerDiff)
  const fix = parseDiff(fixDiff)
  const removed = []
  for (const [file, { removed: gone }] of Object.entries(fix)) {
    const added = new Set((worker[file]?.added ?? []).filter(l => !isTrivial(l)))
    for (const line of gone) {
      if (!isTrivial(line) && added.has(line)) removed.push({ file, line })
    }
  }
  return { refuse: removed.length > 0, removed }
}
