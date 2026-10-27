/**
 * #1894 contract — teardown must target the resources an app ACTUALLY has.
 *
 * The case that minted these: tearing down the retired `bookmark-stash` POC. The documented-safe
 * `--scope staging` resolved `bookmark-stash-staging`, which never existed — so the run reported
 * success and the live worker at `bookmark-stash.pmcp.dev` kept serving. The only path that
 * reached it was `--scope both` with a typed PROD confirmation, on a POC that was never
 * production. That trains an operator to type a prod confirm as routine, which is the whole
 * point of the guard gone.
 *
 * A POC deployed by `deploy-pocs.yml` has exactly ONE deploy, at the BASE name, carrying the
 * `<app>.pmcp.dev` route. There is no prod counterpart to protect.
 *
 *   node --test scripts/teardown-app.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectAppKind, resolveScope, plannedEnvs, needsProdGuard, findAppHistory, executeTeardown } from './teardown-app.mjs'

// ── detectAppKind ─────────────────────────────────────────────────────────────────
test('a live pocs/ directory identifies a POC', () => {
  assert.equal(detectAppKind({ app: 'quotes', hasPocDir: true }), 'poc')
})

test('a live apps/ directory identifies a launched app', () => {
  assert.equal(detectAppKind({ app: 'velo', hasAppDir: true }), 'app')
})

test('git history identifies a POC after its directory is gone — the bookmark-stash case', () => {
  assert.equal(detectAppKind({ historyKind: 'poc' }), 'poc')
})

test('git history identifies a launched app after its directory is gone', () => {
  assert.equal(detectAppKind({ historyKind: 'app' }), 'app')
})

test('a directory outranks history (a promoted POC has pocs/ history)', () => {
  assert.equal(detectAppKind({ hasAppDir: true, historyKind: 'poc' }), 'app')
})

test('no directory and no history is unknown — must not be guessed as either', () => {
  assert.equal(detectAppKind({ app: 'ghost' }), 'unknown')
})

// ── resolveScope: a POC's only deploy is at the BASE name ─────────────────────────
test('a POC resolves the BASE worker name, not <app>-staging — the #1894 bug', () => {
  const r = resolveScope('bookmark-stash', 'staging', null, 'poc')
  assert.equal(r.worker, 'bookmark-stash')
  assert.equal(r.d1, 'bookmark-stash-db')
  assert.equal(r.kvTitle, 'bookmark-stash-kv')
})

test('a POC reads its real names off the BASE wrangler block, not env.staging', () => {
  const config = {
    name: 'bookmark-stash',
    d1_databases: [{ binding: 'DB', database_name: 'bookmark-stash-db' }],
    env: { staging: { d1_databases: [{ database_name: 'bookmark-stash-staging-db' }] } },
  }
  assert.equal(resolveScope('bookmark-stash', 'staging', config, 'poc').d1, 'bookmark-stash-db')
})

test('a launched app keeps the existing staging/prod split', () => {
  assert.equal(resolveScope('velo', 'staging', null, 'app').worker, 'velo-staging')
  assert.equal(resolveScope('velo', 'prod', null, 'app').worker, 'velo')
})

test('an unknown kind keeps the conservative app split', () => {
  // Fail safe: treat an unidentifiable app like a launched one, so the prod guard still applies.
  assert.equal(resolveScope('ghost', 'staging', null, 'unknown').worker, 'ghost-staging')
})

// ── plannedEnvs / needsProdGuard ──────────────────────────────────────────────────
test('a POC has exactly one env whatever scope was asked for', () => {
  assert.deepEqual(plannedEnvs('poc', 'staging'), ['staging'])
  assert.deepEqual(plannedEnvs('poc', 'both'), ['staging'])
  assert.deepEqual(plannedEnvs('poc', 'prod'), ['staging'])
})

test('a launched app expands scopes as before', () => {
  assert.deepEqual(plannedEnvs('app', 'staging'), ['staging'])
  assert.deepEqual(plannedEnvs('app', 'prod'), ['prod'])
  assert.deepEqual(plannedEnvs('app', 'both'), ['staging', 'prod'])
})

test('a POC never trips the prod guard — it has no production to protect', () => {
  assert.equal(needsProdGuard('poc', 'both'), false)
  assert.equal(needsProdGuard('poc', 'prod'), false)
})

test('a launched app still trips the prod guard', () => {
  assert.equal(needsProdGuard('app', 'prod'), true)
  assert.equal(needsProdGuard('app', 'both'), true)
  assert.equal(needsProdGuard('app', 'staging'), false)
})

test('an UNKNOWN app still trips the prod guard — fail closed on the destructive path', () => {
  assert.equal(needsProdGuard('unknown', 'prod'), true)
  assert.equal(needsProdGuard('unknown', 'both'), true)
})

// ── case 10: names come from git history, not labels.yml ──────────────────────────
const WR = '{ "name": "crouton-builder-demo", "d1_databases": [{ "database_name": "crouton-builder-demo-db" }], "kv_namespaces": [{ "id": "kv1" }] }'
function fakeGit(files) {
  // files: { '<ref>:<path>': content }; log answers per pathspec prefix
  return (args) => {
    if (args[0] === 'log') {
      const prefix = args.at(-1)
      const hit = files.logs?.[prefix]
      return hit ?? ''
    }
    const v = files[args[1]]
    if (v === undefined) throw new Error('fatal: path does not exist')
    return v
  }
}

test('case 10: kind and config come from the last commit that had pocs/<app>/', () => {
  const git = fakeGit({
    logs: { 'pocs/crouton-builder-demo/': 'abc123 200' },
    // the last commit is the deletion, so the file only exists in its parent
    'abc123^:pocs/crouton-builder-demo/wrangler.jsonc': WR,
  })
  const h = findAppHistory('crouton-builder-demo', git)
  assert.equal(h.kind, 'poc')
  assert.equal(h.config.d1_databases[0].database_name, 'crouton-builder-demo-db')
  const r = resolveScope('crouton-builder-demo', 'staging', h.config, detectAppKind({ historyKind: h.kind }))
  assert.equal(r.worker, 'crouton-builder-demo')
  assert.equal(r.d1, 'crouton-builder-demo-db')
  assert.equal(r.kvTitle, 'crouton-builder-demo-kv')
})

test('case 10: the newer of pocs/ and apps/ history wins (promotion)', () => {
  const git = fakeGit({ logs: { 'pocs/foo/': 'aaa 100', 'apps/foo/': 'bbb 300' } })
  assert.equal(findAppHistory('foo', git).kind, 'app')
})

test('case 10: no history at all returns null', () => {
  assert.equal(findAppHistory('ghost', fakeGit({})), null)
})

// ── cases 6, 7, 8: backup, verify, already gone ───────────────────────────────────
const silent = { log() {}, error() {} }
const scope = { env: 'staging', worker: 'foo', d1: 'foo-db', kvTitle: 'foo-kv', kvId: null }

/** A fake Cloudflare: tracks what exists; `stubborn` resources survive their delete. */
function fakeCf({ exists = ['worker:foo', 'd1:foo-db', 'kv:foo-kv'], failExport = false, stubborn = [] } = {}) {
  const live = new Set(exists)
  const calls = []
  const run = (args) => {
    calls.push(args.join(' '))
    const [a, b] = args
    if (a === 'd1' && b === 'export') {
      if (failExport) throw new Error('export boom: 500')
      if (!live.has(`d1:${args[2]}`)) throw new Error("Couldn't find DB with name")
      return ''
    }
    if (a === 'delete') {
      if (!live.has(`worker:${args[2]}`)) throw new Error('This Worker does not exist [code: 10007]')
      if (!stubborn.includes(`worker:${args[2]}`)) live.delete(`worker:${args[2]}`)
      return ''
    }
    if (a === 'd1' && b === 'delete') {
      if (!live.has(`d1:${args[2]}`)) throw new Error("Couldn't find DB")
      if (!stubborn.includes(`d1:${args[2]}`)) live.delete(`d1:${args[2]}`)
      return ''
    }
    if (a === 'd1' && b === 'list') return JSON.stringify([...live].filter(x => x.startsWith('d1:')).map(x => ({ name: x.slice(3) })))
    if (a === 'kv' && b === 'namespace' && args[2] === 'list') return JSON.stringify([...live].filter(x => x.startsWith('kv:')).map(x => ({ id: 'id-' + x.slice(3), title: x.slice(3) })))
    if (a === 'kv' && b === 'namespace' && args[2] === 'delete') {
      live.delete('kv:' + args[3 + 1].replace('id-', ''))
      return ''
    }
    if (a === 'deployments') {
      if (!live.has(`worker:${args[3]}`)) throw new Error('This Worker does not exist [code: 10007]')
      return '[]'
    }
    throw new Error('unexpected ' + args.join(' '))
  }
  return { run, calls, live }
}

test('case 6: the D1 is exported before anything is deleted', () => {
  const cf = fakeCf()
  executeTeardown([scope], { run: cf.run, log: silent })
  const exportAt = cf.calls.findIndex(c => c.startsWith('d1 export foo-db --remote --output'))
  const firstDelete = cf.calls.findIndex(c => c.startsWith('delete ') || c.startsWith('d1 delete'))
  assert.ok(exportAt >= 0 && exportAt < firstDelete)
})

test('case 6: a failed export deletes NOTHING and aborts', () => {
  const cf = fakeCf({ failExport: true })
  const out = executeTeardown([scope], { run: cf.run, log: silent })
  assert.ok(out.aborted)
  assert.ok(!cf.calls.some(c => c.startsWith('delete ') || c.includes(' delete ')))
  assert.equal(cf.live.size, 3)
})

test('case 7: a resource that survives its delete is reported not-deleted', () => {
  const cf = fakeCf({ stubborn: ['d1:foo-db'] })
  const { results } = executeTeardown([scope], { run: cf.run, log: silent })
  assert.equal(results.find(r => r.type === 'd1').status, 'not-deleted')
  assert.equal(results.find(r => r.type === 'worker').status, 'deleted')
})

test('case 7: verification is exact-name — a similarly named D1 does not mask or fake a result', () => {
  const cf = fakeCf({ exists: ['worker:foo', 'd1:foo-db', 'd1:foo-db-2', 'kv:foo-kv'] })
  const { results } = executeTeardown([scope], { run: cf.run, log: silent })
  assert.equal(results.find(r => r.type === 'd1').status, 'deleted')
  assert.ok(cf.live.has('d1:foo-db-2'))
})

test('case 8: resources already gone are "absent", not failures', () => {
  const cf = fakeCf({ exists: [] })
  const { aborted, results } = executeTeardown([scope], { run: cf.run, log: silent })
  assert.equal(aborted, null)
  assert.deepEqual(results.map(r => r.status), ['absent', 'absent', 'absent'])
})
