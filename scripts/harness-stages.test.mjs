/**
 * WS2 (#954) contract — the declared stage model resolves correctly, reproduces the
 * #779 test-first table exactly, and a `poc → spike` rename is a one-line config edit
 * that leaves resolution unchanged.
 *
 *   node --test scripts/harness-stages.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadStages, stageForPath, gateMode, deployTargetForPath, validate, isEditGuarded, editGuardedStages } from './harness-stages.mjs'

const model = await loadStages()

test('the shipped default profile is valid', () => {
  assert.deepEqual(validate(model), [])
})

test('#779 table: packages/* → test-first ON', () => {
  assert.equal(stageForPath('packages/crouton-core/app/x.ts', model).name, 'package')
  assert.equal(gateMode('packages/crouton-core/app/x.ts', 'test-first', model), 'on')
})

test('#779 table: apps/* → test-first OPT-IN', () => {
  assert.equal(stageForPath('apps/velo/server/y.ts', model).name, 'app')
  assert.equal(gateMode('apps/velo/server/y.ts', 'test-first', model), 'opt-in')
})

test('#779 table: pocs/* → test-first OFF', () => {
  assert.equal(stageForPath('pocs/loop-station/app.vue', model).name, 'poc')
  assert.equal(gateMode('pocs/loop-station/app.vue', 'test-first', model), 'off')
})

test('paths under no stage resolve to unstaged with no required gates', () => {
  const r = stageForPath('scripts/harness-stages.mjs', model)
  assert.equal(r.name, null)
  assert.equal(gateMode('scripts/harness-stages.mjs', 'test-first', model), 'off')
  assert.equal(gateMode('.claude/skills/commit/SKILL.md', 'test-first', model), 'off')
})

test('deploy targets match current reality', () => {
  assert.equal(deployTargetForPath('pocs/x/app.vue', model), 'preview')
  assert.equal(deployTargetForPath('apps/velo/x.ts', model), 'staging')
  assert.equal(deployTargetForPath('packages/crouton-core/x.ts', model), 'none')
})

test('path normalisation: leading ./ and / and backslashes resolve the same', () => {
  assert.equal(stageForPath('./packages/a/b.ts', model).name, 'package')
  assert.equal(stageForPath('/packages/a/b.ts', model).name, 'package')
  assert.equal(stageForPath('packages\\a\\b.ts', model).name, 'package')
})

test('THE renamable-stage proof: poc → spike is a one-line key rename, gates unchanged', () => {
  // Simulate the one-line edit a scrum team makes: rename the `poc` key to `spike`.
  const { poc, ...rest } = model.stages
  const renamed = { stages: { spike: poc, ...rest }, unstaged: model.unstaged }

  // Same path, now resolves to `spike` — and every gate/deploy decision is identical.
  const before = stageForPath('pocs/x/app.vue', model)
  const after = stageForPath('pocs/x/app.vue', renamed)
  assert.equal(before.name, 'poc')
  assert.equal(after.name, 'spike')
  assert.deepEqual(after.stage.gates, before.stage.gates)
  assert.equal(gateMode('pocs/x/app.vue', 'test-first', renamed), 'off')
  assert.equal(deployTargetForPath('pocs/x/app.vue', renamed), 'preview')
  assert.deepEqual(validate(renamed), [])
})

test('longest-prefix wins when a more specific stage path is declared', () => {
  // A consumer could carve a sub-tree out of a broader stage; the deepest match wins.
  const custom = {
    stages: {
      app: { paths: ['apps/'], gates: [], optionalGates: ['test-first'], deploy: 'staging' },
      'app-core': { paths: ['apps/core/'], gates: ['test-first'], optionalGates: [], deploy: 'none' }
    },
    unstaged: model.unstaged
  }
  assert.equal(stageForPath('apps/velo/x.ts', custom).name, 'app')
  assert.equal(stageForPath('apps/core/x.ts', custom).name, 'app-core')
  assert.equal(gateMode('apps/core/x.ts', 'test-first', custom), 'on')
})

test('edit-guard: packages/ is guarded, pocs/ and apps/ are not', () => {
  assert.equal(isEditGuarded('packages/crouton-core/x.ts', model), true)
  assert.equal(isEditGuarded('pocs/loop-station/app.vue', model), false)
  assert.equal(isEditGuarded('apps/velo/x.ts', model), false)
  assert.deepEqual(editGuardedStages(model), ['package'])
})

test('validate rejects a non-boolean editGuard', () => {
  const bad = { stages: { x: { paths: ['x/'], gates: [], optionalGates: [], deploy: 'none', editGuard: 'yes' } } }
  assert.ok(validate(bad).some((p) => p.includes('editGuard must be a boolean')))
})

test('validate rejects an unknown gate id', () => {
  const bad = { stages: { x: { paths: ['x/'], gates: ['not-a-gate'], optionalGates: [], deploy: 'none' } } }
  assert.ok(validate(bad).some((p) => p.includes('unknown gate')))
})

test('--json CLI mode: single path resolves to a structured object matching stageForPath/gateMode', async () => {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync('node', ['scripts/harness-stages.mjs', '--json', 'packages/crouton-core/app/foo.ts'], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  assert.equal(parsed.path, 'packages/crouton-core/app/foo.ts')
  assert.equal(parsed.stage, 'package')
  assert.equal(parsed.deploy, 'none')
  assert.deepEqual(parsed.gates.required, ['test-first'])
  assert.deepEqual(parsed.gates.optIn, [])
  assert.equal(parsed.editGuard, true)
})

test('--json CLI mode: multiple paths resolve to an array, one entry per path', async () => {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync('node', ['scripts/harness-stages.mjs', '--json', 'packages/crouton-core/app/foo.ts', 'apps/velo/foo.ts'], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].stage, 'package')
  assert.equal(parsed[1].stage, 'app')
  assert.equal(parsed[1].deploy, 'staging')
})

test('--json is absent from human-readable output and does not change --check exit codes', async () => {
  const { execFileSync } = await import('node:child_process')
  const humanOut = execFileSync('node', ['scripts/harness-stages.mjs', 'packages/crouton-core/app/foo.ts'], { encoding: 'utf8' })
  assert.ok(humanOut.includes('stage: package'))
  assert.doesNotThrow(() => execFileSync('node', ['scripts/harness-stages.mjs', '--check'], { encoding: 'utf8' }))
})
