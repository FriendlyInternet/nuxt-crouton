import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ALLOW, analyze, compareTrees, missesBodyValidation, readDriftReport, regenerate, renderDriftLines,
} from './app-collection-drift.mjs'

const b = s => Buffer.from(s)
const P = 'layers/a/collections/things'

test('identical trees are current', () => {
  const t = { [`${P}/x.ts`]: b('1') }
  const c = compareTrees(t, { ...t })
  assert.deepEqual([c.changed, c.missing, c.extra], [[], [], []])
  assert.equal(analyze('pocs/x', t, { status: 'ok', tree: t }).status, 'current')
})

test('changed / missing / extra files make a collection behind', () => {
  const committed = { [`${P}/a.ts`]: b('1'), [`${P}/old.ts`]: b('1') }
  const regen = { [`${P}/a.ts`]: b('2'), [`${P}/seed.json`]: b('[]') }
  const c = compareTrees(committed, regen)
  assert.deepEqual([c.changed, c.missing, c.extra], [[`${P}/a.ts`], [`${P}/seed.json`], [`${P}/old.ts`]])
  assert.equal(analyze('pocs/x', committed, { status: 'ok', tree: regen }).status, 'behind')
})

test('collection dirs on one side only are reported', () => {
  const c = compareTrees({ 'layers/a/collections/agendas/x.ts': b('1') }, { 'layers/a/collections/agenda/x.ts': b('1') })
  assert.deepEqual(c.configuredNotCommitted, ['layers/a/collections/agenda'])
  assert.deepEqual(c.committedNotConfigured, ['layers/a/collections/agendas'])
})

test('generator error → error status with the Error: line', () => {
  const r = analyze('pocs/x', {}, { status: 'error', error: 'Error: Field "order" collides' })
  assert.equal(r.status, 'error')
  assert.match(r.error, /collides/)
})

test('missesBodyValidation lists readBody routes only', () => {
  const r = missesBodyValidation({
    'layers/a/collections/t/server/api/x/index.post.ts': b('readBody(event)'),
    'layers/a/collections/t/server/api/x/[tId].patch.ts': b('readValidatedBody(event, s)'),
    'layers/a/collections/t/server/api/x/reorder.patch.ts': b('readBody(event)'),
  })
  assert.deepEqual(r, ['layers/a/collections/t/server/api/x/index.post.ts'])
})

test('ALLOW: listed stays visible; stale entry flagged', () => {
  const committed = { [`${P}/a.ts`]: b('1') }
  const regen = { [`${P}/a.ts`]: b('2') }
  const r = analyze('pocs/x', committed, { status: 'ok', tree: regen }, { [`pocs/x/${P}`]: 'hand edit' })
  assert.equal(r.collections[0].status, 'allowed')
  assert.equal(r.collections[0].reason, 'hand edit')
  const stale = analyze('pocs/x', committed, { status: 'ok', tree: committed }, { [`pocs/x/${P}`]: 'hand edit' })
  assert.match(stale.problems[0], /remove from ALLOW/)
  assert.deepEqual(ALLOW, {})
})

test('CLI exits 0 with [] against a root with no apps', () => {
  const root = mkdtempSync(join(tmpdir(), 'acd-'))
  try {
    const out = execFileSync('node', ['scripts/app-collection-drift.mjs', '--json', '--root', root], { encoding: 'utf8' })
    assert.deepEqual(JSON.parse(out), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('failure after files are written → error, no partial compare, copy removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'acd-'))
  try {
    const app = join(root, 'app')
    mkdirSync(app)
    writeFileSync(join(app, 'crouton.config.js'), 'export default {}')
    let copyDir
    const run = (_cmd, _args, opts) => {
      copyDir = opts.cwd
      mkdirSync(join(copyDir, 'layers/a/collections/t'), { recursive: true })
      writeFileSync(join(copyDir, 'layers/a/collections/t/x.ts'), 'x')
      throw Object.assign(new Error('boom'), { stderr: 'noise\nError: Cannot find module auth\n' })
    }
    const r = regenerate(app, { run })
    assert.equal(r.status, 'error')
    assert.match(r.error, /Cannot find module/)
    assert.equal(r.tree, undefined)
    assert.equal(existsSync(copyDir), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('readDriftReport: missing / invalid / valid', () => {
  assert.match(readDriftReport('/nonexistent/x.json').error, /could not run/)
  const dir = mkdtempSync(join(tmpdir(), 'acd-'))
  try {
    writeFileSync(join(dir, 'bad.json'), '{not json')
    assert.match(readDriftReport(join(dir, 'bad.json')).error, /could not run/)
    writeFileSync(join(dir, 'ok.json'), '[]')
    assert.deepEqual(readDriftReport(join(dir, 'ok.json')), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('renderDriftLines', () => {
  assert.equal(renderDriftLines(null), null)
  assert.equal(renderDriftLines([{ app: 'a', status: 'current', collections: [], routesWithoutBodyValidation: [] }]), null)
  assert.match(renderDriftLines({ error: 'x' }).join('\n'), /could not run/)
  const text = renderDriftLines([
    { app: 'pocs/s', status: 'error', error: 'Error: bad' },
    { app: 'pocs/c', status: 'behind', collections: [{ status: 'behind' }, { status: 'current' }], filesBehind: 38, routesWithoutBodyValidation: ['a', 'b'] },
  ]).join('\n')
  assert.match(text, /⛔ can't regenerate/)
  assert.match(text, /🟡 1\/2 collections behind \(38 files\)/)
  assert.match(text, /🔴 2 routes without body validation/)
})

test('allow-listed collection stays visible in the digest lines', () => {
  const dir = 'pocs/x/layers/a/collections/t'
  const r = analyze('pocs/x', { 'layers/a/collections/t/f.ts': b('1') }, { status: 'ok', tree: { 'layers/a/collections/t/f.ts': b('2') } }, { [dir]: 'hand edit' })
  assert.equal(r.status, 'current')
  const text = renderDriftLines([r]).join('\n')
  assert.match(text, /allowed: hand edit/)
})

test('an app that cannot regenerate still reports its unvalidated routes', () => {
  const r = analyze('pocs/s', { 'layers/a/collections/t/server/api/x/index.post.ts': b('readBody(event)') }, { status: 'error', error: 'Error: bad' })
  assert.equal(r.routesWithoutBodyValidation.length, 1)
  const text = renderDriftLines([r]).join('\n')
  assert.match(text, /can't regenerate/)
  assert.match(text, /1 routes without body validation/)
})

test('readCollections builds layers/<l>/collections/<name>/… keys from disk', async () => {
  const { readCollections } = await import('./app-collection-drift.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'rc-'))
  try {
    mkdirSync(join(dir, 'layers/a/collections/t/app'), { recursive: true })
    mkdirSync(join(dir, 'layers/a/other'), { recursive: true })
    writeFileSync(join(dir, 'layers/a/collections/t/app/f.ts'), 'x')
    writeFileSync(join(dir, 'layers/a/other/skip.ts'), 'y')
    assert.deepEqual(Object.keys(readCollections(dir)), ['layers/a/collections/t/app/f.ts'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('regenerate extracts the Error: line from a failing run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-'))
  try {
    mkdirSync(join(dir, 'app'))
    const run = () => { throw Object.assign(new Error('boom'), { stderr: 'noise\nError: Cannot find module x\nmore' }) }
    assert.deepEqual(regenerate(join(dir, 'app'), { run }), { status: 'error', error: 'Error: Cannot find module x' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
