// layer: stack
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
