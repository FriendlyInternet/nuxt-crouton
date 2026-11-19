// #3846 — the harness always runs from main; the epic branch is only READ, from a second worktree.
//   node --test scripts/epic-checkout.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveEpicBranch, addEpicWorktree, assertDestOutside } from './epic-checkout.mjs'

test('resolveEpicBranch: the block\'s epic_branch, else the epic/<n>- head, else blank', () => {
  assert.equal(resolveEpicBranch({ body: '<!-- pipeline: epic=5 depth=1 epic_branch=epic/5-from-block -->', heads: ['abc\trefs/heads/epic/5-other'], epic: 12 }), 'epic/5-from-block')
  assert.equal(resolveEpicBranch({ body: 'no block', heads: ['abc\trefs/heads/epic/5-x'], epic: 5 }), 'epic/5-x')
  assert.equal(resolveEpicBranch({ body: '', heads: ['abc\trefs/heads/epic/5--v1-x'], epic: 5 }), 'epic/5--v1-x')
  // a ticket's block names its epic → that epic's branch
  assert.equal(resolveEpicBranch({ body: '<!-- pipeline: epic=5 depth=1 -->', heads: ['refs/heads/epic/5-x'], epic: 12 }), 'epic/5-x')
  // never epic/50-… for epic 5
  assert.equal(resolveEpicBranch({ body: '', heads: ['abc\trefs/heads/epic/50-x'], epic: 5 }), '')
  assert.equal(resolveEpicBranch({ body: '', heads: [], epic: 5 }), '')
})

test('the dest must sit outside the workspace, under $RUNNER_TEMP', () => {
  assert.throws(() => assertDestOutside('/ws/epic-src', { cwd: '/ws', runnerTemp: '/rt' }), /inside the workspace/)
  assert.throws(() => assertDestOutside('/elsewhere/x', { cwd: '/ws', runnerTemp: '/rt' }), /RUNNER_TEMP/)
  assert.equal(assertDestOutside('/rt/epic-src', { cwd: '/ws', runnerTemp: '/rt' }), '/rt/epic-src')
})

test('addEpicWorktree (real git): main worktree HEAD and branch unchanged, epic file only in dest', () => {
  const root = mkdtempSync(join(tmpdir(), 'epic-co-'))
  const origin = join(root, 'origin')
  const ws = join(root, 'ws')
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  execFileSync('git', ['init', '-q', '-b', 'main', origin])
  g(origin, 'config', 'user.email', 't@t'); g(origin, 'config', 'user.name', 't')
  writeFileSync(join(origin, 'a.txt'), 'main\n'); g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'main')
  g(origin, 'checkout', '-qb', 'epic/5-x')
  writeFileSync(join(origin, 'only-on-epic.txt'), 'epic\n'); g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'epic')
  g(origin, 'checkout', '-q', 'main')
  execFileSync('git', ['clone', '-q', `file://${origin}`, ws])
  const headBefore = g(ws, 'rev-parse', 'HEAD')
  const heads = g(ws, 'ls-remote', '--heads', 'origin', 'epic/5-*').split('\n')
  const branch = resolveEpicBranch({ body: '', heads, epic: 5 })
  assert.equal(branch, 'epic/5-x')
  const dest = join(root, 'rt', 'epic-src')
  assert.equal(addEpicWorktree({ branch, dest, git: (args) => g(ws, ...args) }), dest)
  assert.equal(g(ws, 'rev-parse', 'HEAD'), headBefore)
  assert.equal(g(ws, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  assert.equal(existsSync(join(ws, 'only-on-epic.txt')), false)
  assert.equal(readFileSync(join(dest, 'only-on-epic.txt'), 'utf8'), 'epic\n')
  assert.equal(g(ws, 'status', '--porcelain'), '', 'the workspace has nothing new to commit')
  // no branch → nothing added, nothing printed
  assert.equal(addEpicWorktree({ branch: '', dest: join(root, 'rt', 'none'), git: () => { throw new Error('must not run git') } }), '')
})

// Wiring: neither job checks out the epic branch; both read it through epic-checkout.mjs.
const wf = (n) => readFileSync(new URL(`../.github/workflows/${n}`, import.meta.url), 'utf8')
for (const f of ['decompose-on-issue-pidev.yml', 'ticket-review.yml']) {
  test(`${f}: no actions/checkout step has a ref:, and the epic branch comes from epic-checkout.mjs under $RUNNER_TEMP`, () => {
    const t = wf(f)
    const steps = t.split(/\n\s+- (?=uses:|name:|id:)/)
    for (const s of steps.filter((x) => /uses: actions\/checkout@/.test(x))) {
      assert.doesNotMatch(s.split(/\n\s+- /)[0], /^\s+ref:/m, `${f} checks out a ref`)
    }
    assert.match(t, /node scripts\/epic-checkout\.mjs --epic "\$(ISSUE|EPIC)" --dest "\$RUNNER_TEMP\/epic-src"/)
  })
}
