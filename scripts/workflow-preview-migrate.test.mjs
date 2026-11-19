// T6 (#4004): the per-PR branch of deploy-app.yml's `deploy` step migrates through
// pr-preview-migrate.mjs, never a bare `wrangler d1 migrations apply` (which re-runs a
// renumbered migration on a kept preview DB). Plain text slicing — no YAML dependency.
//   node --test scripts/workflow-preview-migrate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const wf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github/workflows/deploy-app.yml'), 'utf8')

function perPrBranch() {
  const lines = wf.split('\n')
  const stepAt = lines.findIndex(l => /^\s+id: deploy\s*$/.test(l))
  assert.ok(stepAt >= 0, 'step id: deploy exists')
  const start = lines.findIndex((l, i) => i > stepAt && /^\s*elif \[ -n "\$PR_NUM" \]; then\s*$/.test(l))
  assert.ok(start > stepAt, 'per-PR branch found in the deploy step')
  const indent = lines[start].match(/^\s*/)[0]
  const end = lines.findIndex((l, i) => i > start && l === `${indent}else`)
  assert.ok(end > start, 'per-PR branch ends at an else at the same indent')
  return lines.slice(start, end).join('\n')
}

test('T6 — the per-PR deploy branch migrates via pr-preview-migrate.mjs', () => {
  const block = perPrBranch()
  assert.match(block, /node "\$GITHUB_WORKSPACE\/scripts\/pr-preview-migrate\.mjs" "\$\{\{ inputs\.app \}\}" "\$PR_NUM" \.output\/server\/wrangler\.json/)
  assert.doesNotMatch(block, /wrangler d1 migrations apply/)
  const idAt = block.indexOf('scripts/pr-preview-db-id.mjs')
  assert.ok(idAt >= 0 && idAt < block.indexOf('scripts/pr-preview-migrate.mjs'), 'ids are resolved before migrating')
})
