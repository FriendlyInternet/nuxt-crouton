import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { namedApps, pickTargets, skippedNote } from './screenshot-targets.mjs'

const cli = fileURLToPath(new URL('./screenshot-targets.mjs', import.meta.url))
const rec = (workspace, app) => ({ app, workspace, meta: `/r/${app}/meta.json` })
const apps = (metas) => metas.map(m => m.split('/')[2]).sort()

test('T1 — #3960 shape: packages + apps/velo + apps/kassa shoots velo and kassa, skips the 7 POCs', () => {
  const pocs = ['status', 'booking-demo', 'snippets', 'gallery', 'crouton-builder', 'pins', 'crate']
  const records = [...pocs.map(p => rec('pocs', p)), rec('apps', 'velo'), rec('apps', 'kassa')]
  const changedFiles = [
    'packages/crouton-core/app/components/Table.vue',
    'packages/crouton-core/app/composables/useCrouton.ts',
    'apps/velo/app/pages/index.vue',
    'apps/kassa/server/api/x.ts'
  ]
  const r = pickTargets({ records, changedFiles, prBody: 'no markers here' })
  assert.equal(r.rule, 'changed-or-named')
  assert.deepEqual(apps(r.shoot), ['kassa', 'velo'])
  assert.equal(r.skipped.length, 7)
  assert.deepEqual(r.skipped.map(s => s.app).sort(), [...pocs].sort())
  assert.ok(r.skipped.every(s => s.why === 'only redeployed because a package it uses changed'))
})

test('T2 — a POC-only PR shoots only that POC', () => {
  const records = [rec('pocs', 'pins'), rec('pocs', 'gallery'), rec('apps', 'velo')]
  const r = pickTargets({ records, changedFiles: ['pocs/pins/app/pages/index.vue'], prBody: '' })
  assert.deepEqual(apps(r.shoot), ['pins'])
  assert.deepEqual(r.skipped.map(s => s.app).sort(), ['gallery', 'velo'])
})

test('T2b — a folder-name prefix does not count as own (apps/velo-x is not apps/velo)', () => {
  const records = [rec('apps', 'velo'), rec('apps', 'velo-x')]
  const r = pickTargets({ records, changedFiles: ['apps/velo-x/a.ts'] })
  assert.deepEqual(apps(r.shoot), ['velo-x'])
})

test('T3 — a named app wins on a package-only PR, plus an app whose folder changed', () => {
  const records = [rec('apps', 'kassa'), rec('apps', 'velo'), rec('pocs', 'gallery')]
  const prBody = 'x\n<!-- review-surface: kassa /admin/test1/x -->\n'
  const named = pickTargets({ records, changedFiles: ['packages/crouton-core/app/utils/a.ts'], prBody })
  assert.equal(named.rule, 'changed-or-named')
  assert.deepEqual(apps(named.shoot), ['kassa'])
  const both = pickTargets({ records, changedFiles: ['packages/crouton-core/app/utils/a.ts', 'apps/velo/x.ts'], prBody })
  assert.deepEqual(apps(both.shoot), ['kassa', 'velo'])
  assert.deepEqual(both.skipped, [{ app: 'gallery', why: 'only redeployed because a package it uses changed' }])
})

test('T4 — package-only PR with no marker shoots at most 2: gallery first for a shared component', () => {
  const records = [rec('pocs', 'pins'), rec('pocs', 'gallery'), rec('apps', 'velo'), rec('apps', 'kassa'), rec('pocs', 'crate')]
  const comp = pickTargets({ records, changedFiles: ['packages/crouton-core/app/components/Foo.vue'] })
  assert.equal(comp.rule, 'package-only')
  assert.equal(comp.shoot.length, 2)
  assert.equal(comp.shoot[0], '/r/gallery/meta.json')
  assert.equal(comp.shoot[1], '/r/kassa/meta.json')
  assert.equal(comp.skipped.length, 3)
  assert.ok(comp.skipped.every(s => s.why === 'package-only PR — showing at most 2 consumers'))

  const logic = pickTargets({ records, changedFiles: ['packages/crouton-core/server/utils/a.ts'] })
  assert.deepEqual(logic.shoot, ['/r/kassa/meta.json', '/r/velo/meta.json'])
  assert.deepEqual(logic.skipped.map(s => s.app), ['crate', 'gallery', 'pins'])
})

test('T5 — namedApps de-duplicates markers and ignores non-markers; a named app with no record is reported', () => {
  const body = [
    '<!-- review-surface: kassa /a -->',
    '<!-- review-surface: velo /b name:x -->',
    '<!--review-surface:kassa /c-->',
    'review-surface: pins /d',
    '<!-- deploy-preview: full-watch -->'
  ].join('\n')
  assert.deepEqual(namedApps(body), ['kassa', 'velo'])
  assert.deepEqual(namedApps(''), [])
  const r = pickTargets({ records: [rec('apps', 'kassa')], changedFiles: [], prBody: body })
  assert.deepEqual(apps(r.shoot), ['kassa'])
  assert.deepEqual(r.skipped, [{ app: 'velo', why: 'named by review-surface but not deployed for this commit' }])
})

test('skippedNote groups apps by reason', () => {
  assert.equal(skippedNote([]), '')
  assert.equal(
    skippedNote([{ app: 'a', why: 'x' }, { app: 'b', why: 'x' }, { app: 'c', why: 'y' }]),
    'skipped 3: a, b (x); c (y)'
  )
})

function recordsDir() {
  const d = mkdtempSync(join(tmpdir(), 'st-'))
  for (const [ws, app] of [['apps', 'velo'], ['pocs', 'pins']]) {
    mkdirSync(join(d, '111', `preview-meta-${app}`), { recursive: true })
    writeFileSync(join(d, '111', `preview-meta-${app}`, 'meta.json'), JSON.stringify({ app, workspace: ws, url: `https://${app}.x`, pr: 1 }))
  }
  return d
}

test('T6 — CLI writes only the changed app to --out and prints count + note', () => {
  const d = recordsDir()
  const out = join(d, 'targets.txt')
  const r = spawnSync('node', [cli, '--records', d, '--pr', '7', '--out', out], {
    env: { ...process.env, PR_BODY: 'body without markers', CHANGED_FILES: 'apps/velo/app/pages/index.vue\npackages/crouton-core/x.ts' },
    encoding: 'utf8'
  })
  assert.equal(r.status, 0, r.stderr)
  const lines = readFileSync(out, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.ok(lines[0].endsWith('preview-meta-velo/meta.json'))
  assert.match(r.stdout, /^count=1$/m)
  assert.match(r.stdout, /^note=skipped 1: pins \(only redeployed because a package it uses changed\)$/m)
  // Every stdout line is a key=value pair, safe to append to $GITHUB_OUTPUT.
  assert.ok(r.stdout.trim().split('\n').every(l => /^[a-z]+=/.test(l)))
})

test('T10 — CLI exits 1 when the PR body cannot be read, and writes no targets', () => {
  const d = recordsDir()
  const out = join(d, 'targets.txt')
  const env = { ...process.env, CHANGED_FILES: 'apps/velo/a.ts' }
  delete env.PR_BODY; delete env.GH_TOKEN; delete env.REPO; delete env.GITHUB_REPOSITORY
  const r = spawnSync('node', [cli, '--records', d, '--pr', '7', '--out', out], { env, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /cannot read the body of PR #7/)
  assert.equal(existsSync(out), false)
})
