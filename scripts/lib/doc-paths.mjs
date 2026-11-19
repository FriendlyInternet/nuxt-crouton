// Pure helpers for the stale-path report in scripts/check-docs.mjs (#3570).
// Finds backticked file paths in a package CLAUDE.md that no longer exist.
// Report only — tuned for zero false hits over full recall.

const PREFIXES = ['packages/', 'app/', 'server/', 'lib/']
const PATTERN_CHARS = /[\s*<>{}[\]$|…:]|\.\.\./
const PLACEHOLDER_BASENAME = /^(use)?(New|My|Your|Example)[A-Z]/

/** @returns {{ line: number, name: string }[]} */
export function extractDocPaths(text) {
  const out = []
  let inFence = false
  const lines = String(text ?? '').split('\n')
  lines.forEach((raw, i) => {
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      return
    }
    if (inFence) return
    for (const m of raw.matchAll(/`([^`\n]+)`/g)) {
      let name = m[1].trim()
      if (!PREFIXES.some(p => name.startsWith(p))) continue
      if (PATTERN_CHARS.test(name)) continue
      name = name.replace(/\/+$/, '')
      const base = name.split('/').pop().replace(/\.[^.]*$/, '')
      if (PLACEHOLDER_BASENAME.test(base)) continue
      out.push({ line: i + 1, name })
    }
  })
  return out
}

/** Index of tracked files + their parent folders, plus every `/`-suffix. */
export function buildPathIndex(files) {
  const all = new Set()
  const suffixes = new Set()
  for (const f of files) {
    const parts = String(f).split('/').filter(Boolean)
    for (let end = 1; end <= parts.length; end++) {
      const p = parts.slice(0, end).join('/')
      all.add(p)
      for (let start = 0; start < end; start++) suffixes.add(parts.slice(start, end).join('/'))
    }
  }
  return { has: p => all.has(p), hasSuffix: rel => suffixes.has(rel) }
}

/** @returns {{ pkg: string, line: number, name: string }[]} */
export function findStaleDocPaths({ pkg, text, index, allow = [] }) {
  const allowed = new Set(allow.filter(a => a.package === pkg).map(a => a.name))
  return extractDocPaths(text)
    .filter(({ name }) => {
      if (allowed.has(name)) return false
      if (name.startsWith('packages/')) return !index.has(name)
      return !index.has(`packages/${pkg}/${name}`) && !index.hasSuffix(name)
    })
    .map(({ line, name }) => ({ pkg, line, name }))
}
