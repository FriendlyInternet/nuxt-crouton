// T7 (#4062): deploy-app.yml's "Verify the review overlay is live" step checks the feedback
// endpoint through review-endpoint-check.mjs (which retries), never a one-shot curl.
// Plain text slicing — no YAML dependency.
//   node --test scripts/workflow-review-endpoint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const wf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github/workflows/deploy-app.yml'), 'utf8')

function runBlock() {
  const lines = wf.split('\n')
  const stepAt = lines.findIndex(l => /^\s+- name: Verify the review overlay is live\s*$/.test(l))
  assert.ok(stepAt >= 0, 'step "Verify the review overlay is live" exists')
  const start = lines.findIndex((l, i) => i > stepAt && /^\s+run: \|\s*$/.test(l))
  assert.ok(start > stepAt, 'step has a run: | block')
  const end = lines.findIndex((l, i) => i > start && /^\s+- name:/.test(l))
  assert.ok(end > start, 'run block ends at the next step')
  return lines.slice(start, end).join('\n')
}

// covers: T7
test('E6 — the overlay step calls review-endpoint-check.mjs and no longer curls /api/_feedback', () => {
  const block = runBlock()
  assert.match(block, /node scripts\/review-endpoint-check\.mjs "\$URL" \|\| fail=1/)
  assert.doesNotMatch(block, /\bcurl\b[^#\n]*(\\\n[^#\n]*)*\/api\/_feedback/)
  assert.doesNotMatch(block, /code="\$\(curl/)
})
