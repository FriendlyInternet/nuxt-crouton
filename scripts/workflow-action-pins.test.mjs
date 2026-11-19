// Every third-party GitHub Action must be pinned to a full commit SHA (#2337).
//
// A tag like `actions/checkout@v7` is a pointer its owner (or an attacker with their
// credentials) can move; this public repo's workflows hold the Cloudflare token and the
// Claude subscription token. A 40-hex SHA is immutable. Keep the human-readable version
// as a trailing comment: `uses: actions/checkout@<sha> # v7.0.1`.
// Local actions (`./.github/actions/...`) and reusable workflows (`./.github/workflows/...`)
// are part of this repo and exempt. Refresh pins in the quarterly dependency sweep.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function ciFiles() {
  const files = readdirSync('.github/workflows').filter(f => /\.ya?ml$/.test(f)).map(f => join('.github/workflows', f))
  if (existsSync('.github/actions')) {
    for (const d of readdirSync('.github/actions')) {
      const p = join('.github/actions', d, 'action.yml')
      if (existsSync(p)) files.push(p)
    }
  }
  return files
}

test('every third-party `uses:` is pinned to a 40-hex commit SHA', () => {
  const bad = []
  for (const file of ciFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/)
      if (!m) return
      const ref = m[1]
      if (ref.startsWith('./')) return // local action or reusable workflow
      if (!/@[0-9a-f]{40}$/.test(ref)) bad.push(`${file}:${i + 1} ${ref}`)
    })
  }
  assert.deepEqual(bad, [], `unpinned actions:\n${bad.join('\n')}`)
})

test('every SHA pin carries a version comment', () => {
  const bare = []
  for (const file of ciFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/uses:\s*[^\s#]+@[0-9a-f]{40}\s*$/.test(line)) bare.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(bare, [], `SHA pins without a "# vX.Y.Z" comment: ${bare.join(', ')}`)
})

// covers: T1 (#4169)
// claude-code-action bundles its Claude Code CLI via @anthropic-ai/claude-agent-sdk. v1.0.162
// bundled Claude Code 2.1.198, which `claude-opus-5-5` (the review/hard tiers in
// .claude/pipeline-models.json) refuses: "version 2.1.280 or newer is required". v1.0.280+
// locks agent-sdk 0.3.327 → Claude Code 2.1.327. All steps share ONE pin so a tier remap in
// pipeline-models.json never needs a workflow edit.
const MIN_CLAUDE_CODE_ACTION = '1.0.280'

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

test(`claude-code-action: one SHA everywhere, version >= v${MIN_CLAUDE_CODE_ACTION}`, () => {
  const pins = []
  for (const file of ciFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/uses:\s*anthropics\/claude-code-action@([0-9a-f]{40})\s*#\s*v?(\d+\.\d+\.\d+)/)
      if (m) pins.push({ where: `${file}:${i + 1}`, sha: m[1], version: m[2] })
      else if (/uses:\s*anthropics\/claude-code-action@/.test(line)) pins.push({ where: `${file}:${i + 1}`, sha: null, version: null })
    })
  }
  assert.ok(pins.length > 0, 'found no anthropics/claude-code-action pins — the matcher is broken or the action was removed')
  const malformed = pins.filter(p => !p.sha).map(p => p.where)
  assert.deepEqual(malformed, [], `claude-code-action pins without SHA + "# vX.Y.Z": ${malformed.join(', ')}`)
  const shas = [...new Set(pins.map(p => p.sha))]
  assert.equal(shas.length, 1, `claude-code-action pinned to ${shas.length} SHAs:\n${pins.map(p => `${p.where} ${p.sha} v${p.version}`).join('\n')}`)
  const old = pins.filter(p => cmpVersion(p.version, MIN_CLAUDE_CODE_ACTION) < 0).map(p => `${p.where} v${p.version}`)
  assert.deepEqual(old, [], `claude-code-action older than v${MIN_CLAUDE_CODE_ACTION} (bundled Claude Code < 2.1.280; Opus refuses it):\n${old.join('\n')}`)
})
