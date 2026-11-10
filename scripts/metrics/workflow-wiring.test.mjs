import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../../.github/workflows/pipeline-metrics.yml', import.meta.url), 'utf8')

test('scripts checkout in pipeline-metrics.yml is pinned to ref: main', () => {
  const steps = wf.split(/\n\s*- (?=uses: actions\/checkout)/).slice(1)
  const scripts = steps.find(s => /sparse-checkout/.test(s) && /^\s*scripts\s*$/m.test(s))
  assert.ok(scripts, 'scripts checkout step not found')
  assert.match(scripts, /^\s*ref: main\s*$/m)
})
