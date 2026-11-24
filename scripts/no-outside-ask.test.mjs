// No workflow asks an outside reviewer (Qodo) for a review any more — the owner stopped the ask (#4360).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')

// covers: T1
test('no workflow posts a /review ask or a qodo-asked-sha marker', () => {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
  assert.ok(files.length > 0, `no workflow files found in ${dir}`)
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8')
    assert.doesNotMatch(body, /['"]\/review\b/, `${f} posts a /review ask`)
    assert.ok(!body.includes('qodo-asked-sha'), `${f} writes a qodo-asked-sha marker`)
  }
})
