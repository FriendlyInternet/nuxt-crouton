/**
 * #2957 — no fixture may tolerate the unresolved-component warning.
 * Placeholders in crouton-i18n/app/stubs make it unnecessary; an `allowConsole`
 * pattern for it would hide a real regression.
 *
 *   node --test scripts/fixture-manifests.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'fixtures')

test('no fixture manifest allows "Failed to resolve component"', () => {
  const manifests = readdirSync(root)
    .map(name => join(root, name, 'e2e.manifest.json'))
    .filter(existsSync)
  assert.ok(manifests.length > 0, 'expected at least one fixture manifest')

  for (const file of manifests) {
    const { allowConsole = [] } = JSON.parse(readFileSync(file, 'utf8'))
    for (const entry of allowConsole) {
      const pattern = typeof entry === 'string' ? entry : entry.pattern
      assert.ok(
        !String(pattern).includes('Failed to resolve component'),
        `${file} allows "Failed to resolve component": ${pattern}`
      )
    }
  }
})
