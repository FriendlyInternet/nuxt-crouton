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

test('publish still runs when collect stops early', () => {
  const steps = wf.split(/\n\s*- (?=name: |uses: )/)
  const collect = steps.find(s => /^name: Collect run \+ job history$/m.test(s))
  const publish = steps.find(s => /^name: Publish collected files$/m.test(s))
  assert.ok(collect && publish, 'collect or publish step not found')
  assert.match(collect, /^\s*id: collect\s*$/m)
  const ifLine = /^\s*if: (.+)$/m.exec(publish)
  assert.ok(ifLine, 'publish step has no if:')
  assert.ok(ifLine[1].includes('!cancelled()'), ifLine[1])
  assert.ok(ifLine[1].includes("steps.collect.outcome != 'skipped'"), ifLine[1])
  const stepTimeout = Number(/^\s*timeout-minutes: (\d+)/m.exec(collect)?.[1])
  const jobTimeout = Number(/^ {4}timeout-minutes: (\d+)/m.exec(wf)?.[1])
  assert.ok(stepTimeout > 0 && jobTimeout > 0 && stepTimeout < jobTimeout, `step ${stepTimeout} vs job ${jobTimeout}`)
})
