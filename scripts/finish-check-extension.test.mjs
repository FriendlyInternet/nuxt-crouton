/**
 * #3762 — the real `.pi/extensions/finish-check.ts` handler skips revise runs: with
 * FINISH_CHECK=1 and REVISE=1 it runs no check (no outcome file) and asks for no follow-up.
 * (A revise / merge-conflict run has the base merge uncommitted in the tree — #3519.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import register from '../.pi/extensions/finish-check.ts'

function handler() {
  let fn
  register({ on: (name, f) => { if (name === 'agent_before_settle') fn = f } })
  assert.equal(typeof fn, 'function', 'extension registers an agent_before_settle handler')
  return fn
}

function withEnv(vars, run) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  return Promise.resolve(run()).finally(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })
}

test('FINISH_CHECK=1 with REVISE=1 → no check, no follow-up', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'finish-check-'))
  await withEnv({ FINISH_CHECK: '1', REVISE: '1', RUNNER_TEMP: tmp }, async () => {
    const out = await handler()({ entries: [] })
    assert.equal(out, undefined)
    assert.equal(existsSync(join(tmp, 'finish-check-outcome.json')), false)
  })
})

test('FINISH_CHECK unset → no check, no follow-up', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'finish-check-'))
  await withEnv({ FINISH_CHECK: '', REVISE: '', RUNNER_TEMP: tmp }, async () => {
    const out = await handler()({ entries: [] })
    assert.equal(out, undefined)
    assert.equal(existsSync(join(tmp, 'finish-check-outcome.json')), false)
  })
})
