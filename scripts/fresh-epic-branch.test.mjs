/** #3881 — `/fresh-branch` sets an epic's stale branch aside. node --test scripts/fresh-epic-branch.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideFreshBranch, collectBranches, summarizeAhead, renderReport, decisionsBody, runFreshBranch } from './fresh-epic-branch.mjs'

const line = b => `Body.\n\n<!-- pipeline: epic=9 depth=1 epic_branch=${b} -->`
const err404 = () => Object.assign(new Error('Not Found'), { status: 404 })

/**
 * A fake GitHub that records every call. `refs` is the set of refs that exist; a rename moves the
 * ref after `renameAfterPolls` polls of the old name (Infinity = never finishes).
 */
function world({ epic = {}, subs = {}, perm = 'admin', prsBase = [], prsHead = [], refs = ['heads/epic/9-x'], compare = { ahead_by: 0, commits: [] }, renameAfterPolls = 0, renameError = null } = {}) {
  const calls = []
  const comments = []
  const live = new Set(refs)
  let oldPolls = 0
  let renamed = null
  const rec = (name, fn) => async (args) => { calls.push({ name, args }); return fn(args) }
  const pullsList = rec('pulls.list', a => ({ data: a.base ? prsBase : prsHead }))
  const github = {
    rest: {
      issues: {
        get: rec('issues.get', () => ({ data: { number: 9, state: 'open', body: line('epic/9-x'), ...epic } })),
        createComment: rec('issues.createComment', a => { comments.push(a.body); return { data: {} } }),
        update: rec('issues.update', () => ({ data: {} })),
      },
      repos: {
        getCollaboratorPermissionLevel: rec('repos.getCollaboratorPermissionLevel', () => ({ data: { permission: perm } })),
        compareCommitsWithBasehead: rec('repos.compareCommitsWithBasehead', () => ({ data: compare })),
      },
      pulls: { list: pullsList },
      git: {
        getRef: rec('git.getRef', ({ ref }) => {
          if (renamed && ref === `heads/${renamed.branch}`) {
            oldPolls++
            if (oldPolls >= renameAfterPolls) { live.delete(ref); live.add(`heads/${renamed.new_name}`) }
          }
          if (!live.has(ref)) throw err404()
          return { data: { ref: `refs/${ref}` } }
        }),
        createRef: rec('git.createRef', () => ({})),
        updateRef: rec('git.updateRef', () => ({})),
        deleteRef: rec('git.deleteRef', () => ({})),
      },
    },
    paginate: async (route, args) => {
      if (typeof route === 'function') return (await route(args)).data
      calls.push({ name: 'sub_issues', args })
      return subs[args.issue_number] || []
    },
    request: async (route, args) => {
      calls.push({ name: 'request', route, args })
      if (renameError) throw renameError
      renamed = { branch: args.branch, new_name: args.new_name }
      if (renameAfterPolls === 0) { live.delete(`heads/${args.branch}`); live.add(`heads/${args.new_name}`) }
      return { status: 201 }
    },
  }
  const log = []
  const core = { info: m => log.push(m), warning: m => log.push(m), setFailed: m => log.push(`FAILED ${m}`) }
  const context = { payload: { issue: { number: 9 }, comment: { user: { login: 'owner' } } }, repo: { owner: 'o', repo: 'r' }, serverUrl: 'https://github.com', runId: 1 }
  let slept = 0
  const run = () => runFreshBranch({ github, context, core, sleep: async () => { slept++ }, now: () => new Date('2026-11-13T12:00:00Z') })
  return { run, calls, comments, log, get slept() { return slept } }
}

const renames = w => w.calls.filter(c => c.name === 'request')
const writes = w => w.calls.filter(c => ['issues.update', 'git.createRef', 'git.updateRef', 'git.deleteRef'].includes(c.name))
const TREE_SUBS = {
  9: [{ number: 10, state: 'open', body: line('epic/9-x') }, { number: 11, state: 'open', body: line('epic/9-x') }],
  10: [{ number: 12, state: 'open', body: line('epic/9-x') }],
}

test('(2) epic + children + grandchild on one branch → one rename to archive/, nothing else written', async () => {
  const w = world({ subs: TREE_SUBS })
  await w.run()
  const r = renames(w)
  assert.equal(r.length, 1)
  assert.equal(r[0].route, 'POST /repos/{owner}/{repo}/branches/{branch}/rename')
  assert.equal(r[0].args.branch, 'epic/9-x')
  assert.equal(r[0].args.new_name, 'archive/epic/9-x')
  assert.deepEqual(writes(w), [])
  assert.equal(w.comments.length, 1)
  assert.match(w.comments[0], /archive\/epic\/9-x/)
  // the grandchild was read (the tree walk goes past one level)
  assert.ok(w.calls.some(c => c.name === 'sub_issues' && c.args.issue_number === 10))
})

test('(3a) two different branch names in the tree → refused, both named, no rename', async () => {
  const w = world({ subs: { 9: [{ number: 10, state: 'open', body: line('epic/9-x') }, { number: 11, state: 'open', body: line('epic/9-y') }] } })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.match(w.comments[0], /epic\/9-x/)
  assert.match(w.comments[0], /epic\/9-y/)
  assert.match(w.comments[0], /not set aside/)
})

test('(3b) no pipeline line anywhere → refused', async () => {
  const w = world({ epic: { body: 'just prose' }, subs: { 9: [{ number: 10, state: 'open', body: 'no line' }] } })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.match(w.comments[0], /epic_branch=/)
})

test('(3c) closed epic → ignored, no comment, no rename', async () => {
  const w = world({ epic: { state: 'closed' }, subs: TREE_SUBS })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.equal(w.comments.length, 0)
  assert.match(w.log.join('\n'), /epic is closed/)
})

test('(3d) no push access → ignored, no comment, no rename', async () => {
  const w = world({ perm: 'read', subs: TREE_SUBS })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.equal(w.comments.length, 0)
  assert.match(w.log.join('\n'), /no push access \(perm=read\)/)
})

test('(4a) an open PR based on the branch → refused and listed', async () => {
  const w = world({ subs: TREE_SUBS, prsBase: [{ number: 41, title: 'child work', html_url: 'u' }] })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.match(w.comments[0], /#41/)
  const base = w.calls.find(c => c.name === 'pulls.list' && c.args.base)
  assert.equal(base.args.base, 'epic/9-x')
})

test('(4b) an open PR from the branch into main → refused and listed', async () => {
  const w = world({ subs: TREE_SUBS, prsHead: [{ number: 50, title: 'epic → main', html_url: 'u' }] })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.match(w.comments[0], /#50/)
  const head = w.calls.find(c => c.name === 'pulls.list' && c.args.head)
  assert.equal(head.args.head, 'o:epic/9-x')
})

test('(4c) archive/<branch> already exists → refused', async () => {
  const w = world({ subs: TREE_SUBS, refs: ['heads/epic/9-x', 'heads/archive/epic/9-x'] })
  await w.run()
  assert.equal(renames(w).length, 0)
  assert.match(w.comments[0], /`archive\/epic\/9-x` already exists/)
})

test('(5) the report lists 20 non-merge subjects plus a count; merge commits are left out', () => {
  const commits = [
    ...Array.from({ length: 25 }, (_, i) => ({ sha: `a${i}`.padEnd(40, '0'), parents: [{}], commit: { message: `feat: work ${i}\n\nbody` } })),
    ...Array.from({ length: 3 }, (_, i) => ({ sha: `m${i}`.padEnd(40, '0'), parents: [{}, {}], commit: { message: `Merge branch main ${i}` } })),
  ]
  const ahead = summarizeAhead({ ahead_by: 28, commits, html_url: 'https://github.com/o/r/compare/main...epic/9-x' })
  assert.equal(ahead.subjects.length, 20)
  assert.equal(ahead.more, 5)
  const body = renderReport({ outcome: 'renamed', branch: 'epic/9-x', archive: 'archive/epic/9-x', ahead })
  assert.match(body, /feat: work 0\b/)
  assert.match(body, /feat: work 19\b/)
  assert.doesNotMatch(body, /feat: work 20\b/)
  assert.match(body, /and 5 more/)
  assert.doesNotMatch(body, /Merge branch main/)
  assert.match(body, /compare\/main\.\.\.epic\/9-x/)
})

test('(6a) rename answers 201, the old ref disappears on the 3rd poll → success comment', async () => {
  const w = world({ subs: TREE_SUBS, renameAfterPolls: 3 })
  await w.run()
  assert.equal(w.comments.length, 1)
  assert.match(w.comments[0], /🔀 \*\*Fresh branch\*\*/)
  assert.match(w.comments[0], /`archive\/epic\/9-x`/)
  assert.match(w.comments[0], /Undo/)
  assert.equal(w.slept, 2)
  assert.ok(!w.log.some(m => m.startsWith('FAILED')))
})

test('(6b) the old ref still exists after the time limit → failure comment that never says "renamed"', async () => {
  const w = world({ subs: TREE_SUBS, renameAfterPolls: Infinity })
  await w.run()
  assert.equal(w.comments.length, 1)
  assert.match(w.comments[0], /did not finish/)
  assert.doesNotMatch(w.comments[0], /renamed/i)
  assert.doesNotMatch(w.comments[0], /Fresh branch/)
  assert.equal(w.slept, 12)
  assert.ok(w.log.some(m => m.startsWith('FAILED')))
})

test('a refused rename request (e.g. 403) → failure comment, no success', async () => {
  const w = world({ subs: TREE_SUBS, renameError: Object.assign(new Error('Resource not accessible by integration'), { status: 403 }) })
  await w.run()
  assert.match(w.comments[0], /did not finish/)
  assert.match(w.comments[0], /403/)
})

test('a ## Decisions log on the epic gets one dated line; an epic without one is never edited', async () => {
  const w = world({ epic: { body: line('epic/9-x') + '\n\n## Decisions\n- 2026-11-01 — earlier' }, subs: TREE_SUBS })
  await w.run()
  const up = w.calls.filter(c => c.name === 'issues.update')
  assert.equal(up.length, 1)
  assert.match(up[0].args.body, /- 2026-11-01 — earlier\n- 2026-11-13 — `\/fresh-branch`: `epic\/9-x` set aside as `archive\/epic\/9-x`/)
  assert.equal(decisionsBody('no heading', { branch: 'b', archive: 'a', date: 'd' }), null)
})

test('collectBranches skips closed sub-issues and stops at 5 levels', () => {
  const deep = (n) => n === 0 ? { body: line('epic/9-deep'), state: 'open', children: [] } : { body: '', state: 'open', children: [deep(n - 1)] }
  assert.deepEqual(collectBranches({ body: '', children: [{ body: line('epic/9-old'), state: 'closed' }, { body: line('epic/9-x'), state: 'open' }] }), ['epic/9-x'])
  assert.deepEqual(collectBranches({ body: '', children: [deep(4)] }), ['epic/9-deep']) // level 5
  assert.deepEqual(collectBranches({ body: '', children: [deep(5)] }), []) // level 6
})

test('decideFreshBranch: the pure order of checks', () => {
  assert.equal(decideFreshBranch({ state: 'closed', perm: 'admin', branches: ['b'] }).action, 'ignore')
  assert.equal(decideFreshBranch({ perm: 'read', branches: ['b'] }).action, 'ignore')
  assert.equal(decideFreshBranch({ perm: 'write', branches: [] }).action, 'refuse')
  assert.deepEqual(decideFreshBranch({ perm: 'write', branches: ['epic/9-x'] }), { action: 'rename', branch: 'epic/9-x', archive: 'archive/epic/9-x' })
})
