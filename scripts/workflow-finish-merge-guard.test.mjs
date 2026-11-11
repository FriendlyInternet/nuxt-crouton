// The finish step's worker-left merge guard (#3704): run the REAL finish-step bash from
// work-issue-pidev.yml (copy loop → #2914 guard → #3704 guard → checkout -f -B → revise-base →
// commits) under `bash -e` in a fixture repo, with a stubbed `gh`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const YML = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8').split('\n')

/** The block scalar (`run: |`) that follows the first line matching `anchor`. */
function block(anchor, key) {
  let i = YML.findIndex((l) => l.includes(anchor))
  assert.ok(i >= 0, anchor)
  while (!new RegExp(`^\\s+${key}: \\|`).test(YML[i])) i++
  const indent = YML[i + 1].match(/^ */)[0].length
  const out = []
  for (i++; i < YML.length && (YML[i] === '' || YML[i].match(/^ */)[0].length >= indent); i++) out.push(YML[i].slice(indent))
  return out
}
const FINISH = block('- id: finish', 'run')
const from = FINISH.findIndex((l) => l.startsWith('CONTENT="$RUNNER_TEMP/commit-content"'))
const to = FINISH.findIndex((l) => l.startsWith('[ "$N" -eq 0 ] && echo "nothing to commit'))
assert.ok(from >= 0 && to > from, 'finish-step slice found')
const SLICE = FINISH.slice(from, to + 1).join('\n')
// #3775: through the push (5), the base check (5a) and the revise verdict (5b), up to the acceptance gate.
const gate = FINISH.findIndex((l) => l.startsWith('# 6) ACCEPTANCE GATE'))
assert.ok(gate > to, 'acceptance-gate anchor found')
const SLICE_5B = FINISH.slice(from, gate).join('\n')

const SCRIPTS = new URL('.', import.meta.url).pathname

/**
 * Fixture: bare origin with main / epic / work; `mainFiles` extra files land on main after the
 * branch point. `prep(git, put)` runs on the work clone before the step (the "worker").
 */
function fixture({ mainFiles = 2, epicMoves = false, epicConflict = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fmg-'))
  const seed = join(root, 'seed'); const origin = join(root, 'origin.git'); const dir = join(root, 'work')
  const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' })
  mkdirSync(seed)
  sh(seed, 'init', '-q', '-b', 'main'); sh(seed, 'config', 'user.email', 't@t'); sh(seed, 'config', 'user.name', 't')
  writeFileSync(join(seed, 'a.txt'), 'a\n'); writeFileSync(join(seed, 'b.txt'), 'b\n'); sh(seed, 'add', '-A'); sh(seed, 'commit', '-qm', 'b0')
  sh(seed, 'branch', 'epic'); sh(seed, 'checkout', '-qb', 'work', 'epic')
  writeFileSync(join(seed, 'w.txt'), 'w\n'); sh(seed, 'add', '-A'); sh(seed, 'commit', '-qm', 'pr work')
  sh(seed, 'checkout', '-q', 'main')
  mkdirSync(join(seed, 'm'))
  for (let n = 0; n < mainFiles; n++) writeFileSync(join(seed, 'm', `f${n}.txt`), `${n}\n`)
  sh(seed, 'add', '-A'); sh(seed, 'commit', '-qm', 'main moves on')
  if (epicMoves) { sh(seed, 'checkout', '-q', 'epic'); writeFileSync(join(seed, 'e.txt'), 'e\n'); sh(seed, 'add', '-A'); sh(seed, 'commit', '-qm', 'epic moves on') }
  // #3775: the base gains a w.txt of its own — an add/add conflict with the PR's w.txt.
  if (epicConflict) { sh(seed, 'checkout', '-q', 'epic'); writeFileSync(join(seed, 'w.txt'), 'epic w\n'); sh(seed, 'add', '-A'); sh(seed, 'commit', '-qm', 'epic adds w.txt') }
  sh(root, 'clone', '-q', '--bare', seed, origin)
  sh(root, 'clone', '-q', origin, dir)
  const git = (...a) => sh(dir, ...a)
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  git('checkout', '-q', 'work')
  const revStart = git('rev-parse', 'HEAD').stdout.trim()
  return { root, dir, git, revStart, put: (f, t) => writeFileSync(join(dir, f), t) }
}

function runStep(fx, { slice = SLICE, guard = null, comments = '', env = {} } = {}) {
  const { root, dir, revStart } = fx
  const bin = join(root, 'bin'); const tmp = join(root, 'tmp')
  mkdirSync(bin, { recursive: true }); mkdirSync(tmp, { recursive: true })
  const log = join(root, 'gh-comments.log'); const list = join(root, 'gh-list.txt'); const out = join(root, 'out.txt')
  writeFileSync(list, comments); writeFileSync(out, '')
  copyFileSync(join(SCRIPTS, 'revise-base.mjs'), join(tmp, 'revise-base.mjs'))
  if (guard) writeFileSync(join(tmp, 'revise-merge-guard.mjs'), guard)
  else copyFileSync(join(SCRIPTS, 'revise-merge-guard.mjs'), join(tmp, 'revise-merge-guard.mjs'))
  // 5/5a/5b collaborators: the real push + verdict scripts; GitHub's "holds the base" check is stubbed (no API here).
  copyFileSync(join(SCRIPTS, 'git-push-retry.mjs'), join(tmp, 'git-push-retry.mjs'))
  copyFileSync(join(SCRIPTS, 'lib/revise-outcome.mjs'), join(tmp, 'revise-outcome.mjs'))
  writeFileSync(join(tmp, 'revise-push.mjs'), 'process.exit(0)\n')
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/bash',
    'case "$1 $2" in',
    '  "pr list") echo 42 ;;',
    '  "issue view") echo t ;;',
    `  "pr comment") printf '%s\\n----\\n' "$5" >> "${log}" ;;`,
    `  api\\ *) cat "${list}" ;;`,
    'esac',
    '',
  ].join('\n'))
  chmodSync(join(bin, 'gh'), 0o755)
  const prelude = [
    'set -uo pipefail',
    `git status --porcelain -uall | sed 's/^...//; s/^.* -> //' | sort -u > "$RUNNER_TEMP/generated.txt"`,
    ': > "$RUNNER_TEMP/inputs.txt"',
    'NIN=0',
    'NGEN="$(grep -c . "$RUNNER_TEMP/generated.txt" || true)"; NGEN=${NGEN:-0}',
  ].join('\n')
  const script = join(root, 'step.sh')
  writeFileSync(script, `${prelude}\n${slice}\necho "HEAD_AFTER=$(git rev-parse HEAD)"\n`)
  const r = spawnSync('bash', ['-e', script], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: tmp, GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x',
      ISSUE: '1', BASE: 'epic', REV_START: revStart, REV_BRANCH: 'work', REV_CONFLICT: '', REV_BASE: '',
      SINCE: '2026-01-01T00:00:00Z', FEEDBACK_FROM: 'https://x/pull/42#c1', ...env },
  })
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
  const tip = fx.git('rev-parse', 'work').stdout.trim()
  return {
    r, out: r.stdout + r.stderr, comments: read(log), outputs: read(out), tip,
    newCommits: Number(fx.git('rev-list', '--count', `${revStart}..work`).stdout.trim()),
    firstParent: Number(fx.git('rev-list', '--first-parent', '--count', `${revStart}..work`).stdout.trim()),
    merges: Number(fx.git('rev-list', '--merges', '--count', `${revStart}..work`).stdout.trim()),
    parents: fx.git('rev-list', '--parents', '-n1', 'work').stdout.trim().split(' ').length - 1,
    files: fx.git('diff', '--name-only', `${tip}~1`, tip).stdout.trim().split('\n').filter(Boolean),
  }
}
const count = (s, m) => s.split(m).length - 1

test('1 worker merges a third branch: nothing committed, refused, merge_refused=1', () => {
  const fx = fixture()
  fx.git('merge', '--no-commit', '--no-ff', 'origin/main')
  const x = runStep(fx)
  assert.equal(x.r.status, 0, x.out)
  assert.equal(x.tip, fx.revStart)
  assert.equal(x.newCommits, 0)
  assert.match(x.out, /pushing nothing \(#3704\)/)
  assert.match(x.outputs, /merge_refused=1/)
  assert.doesNotMatch(x.out, /HEAD_AFTER=/)
})

test('2 normal revise: one 1-parent commit with exactly the edited files, no comment', () => {
  const fx = fixture()
  fx.put('a.txt', 'edited\n'); fx.put('w.txt', 'edited\n')
  const x = runStep(fx)
  assert.equal(x.r.status, 0, x.out)
  assert.equal(x.newCommits, 1)
  assert.equal(x.parents, 1)
  assert.deepEqual(x.files.sort(), ['a.txt', 'w.txt'])
  assert.equal(x.comments, '')
  assert.doesNotMatch(x.outputs, /merge_refused/)
})

test('3 harness base merge (#2883): base moved, revise-base merges it — 2-parent merge, no refusal', () => {
  const fx = fixture({ epicMoves: true })
  fx.put('w.txt', 'edited\n')
  const x = runStep(fx)
  assert.equal(x.r.status, 0, x.out)
  assert.ok(x.merges >= 1, 'a merge commit was made')
  assert.match(x.out, /revise base \(#2883\): merged/)
  assert.doesNotMatch(x.out, /#3704/)
  assert.doesNotMatch(x.outputs, /merge_refused/)
})

test('4 one comment per head: second run on the same head posts none', () => {
  const fx = fixture()
  fx.git('merge', '--no-commit', '--no-ff', 'origin/main')
  const a = runStep(fx)
  assert.equal(a.r.status, 0, a.out)
  assert.equal(count(a.comments, '<!-- revise-merge-refused:'), 1)
  const b = runStep(fx, { comments: a.comments })
  assert.equal(b.r.status, 0, b.out)
  assert.equal(count(b.comments, '<!-- revise-merge-refused:'), 1, 'no new entry')
  assert.match(b.outputs, /merge_refused=1/)
})

test('5 PR #3688 replay: 267 files merged in — no commit, comment says 267 files and names epic', () => {
  const fx = fixture({ mainFiles: 267 })
  fx.git('merge', '--no-commit', '--no-ff', 'origin/main')
  const x = runStep(fx)
  assert.equal(x.r.status, 0, x.out)
  assert.equal(x.newCommits, 0)
  assert.match(x.comments, /267 files/)
  assert.match(x.comments, /update `epic` itself/)
})

test('6 guard crashes: warning, and the normal commit still happens', () => {
  const fx = fixture()
  fx.put('a.txt', 'edited\n'); fx.put('w.txt', 'edited\n')
  const x = runStep(fx, { guard: 'process.exit(1)\n' })
  assert.equal(x.r.status, 0, x.out)
  assert.match(x.out, /merge guard crashed \(exit 1\)/)
  assert.equal(x.newCommits, 1)
  assert.equal(x.parents, 1)
})

test('7 wiring removed: the flat 1-parent copy of main comes back (the test needs the wiring)', () => {
  const fx = fixture()
  fx.git('merge', '--no-commit', '--no-ff', 'origin/main')
  const unwired = SLICE.split('\n').map((l) => (l.includes('revise-merge-guard.mjs') ? 'GRC=0' : l)).join('\n')
  assert.notEqual(unwired, SLICE)
  const x = runStep(fx, { slice: unwired })
  assert.equal(x.r.status, 0, x.out)
  assert.equal(x.newCommits, 1)
  assert.equal(x.parents, 1)
  assert.deepEqual(x.files.sort(), ['m/f0.txt', 'm/f1.txt'])
})

test('8 base moves during the run and conflicts (#3756): exit 1, nothing committed, PR told the change was not pushed', () => {
  const fx = fixture({ epicConflict: true })
  fx.put('a.txt', 'requested fix\n')
  const x = runStep(fx, { env: { BASE_MERGED: 'abc1234' } })
  assert.equal(x.r.status, 1, x.out)
  assert.equal(x.newCommits, 0)
  assert.equal(count(x.comments, '----'), 1, x.comments)
  assert.match(x.comments, /was not pushed/)
  assert.match(x.comments, /`a\.txt`/, 'names the staged edit')
  assert.match(x.comments, /`w\.txt`/, 'names the conflict')
  assert.match(x.out, /revise base \(#2883\): failed[^\n]*w\.txt/, 'the log names the conflicting file')
})

/** The conflict step's merge, resolution only (as verify now stages it): w.txt = both sides. */
function conflictMerge(fx) {
  fx.git('merge', '--no-edit', 'origin/epic')
  fx.put('w.txt', 'w\nepic w\n')
  fx.git('add', 'w.txt'); fx.git('commit', '-qm', 'Merge epic into work (resolve conflicts)')
  return fx.git('rev-parse', 'HEAD').stdout.trim()
}

test('9 conflict + requested edit in the conflicted file -> two commits, revised, "Revised from" names the second (#3775)', () => {
  const fx = fixture({ epicConflict: true })
  const merge = conflictMerge(fx)
  fx.put('w.txt', 'w\nepic w\nrequested\n')
  const x = runStep(fx, { slice: SLICE_5B, env: { REV_BASE: merge, REV_CONFLICT: '1', BASE_MERGED: merge } })
  assert.equal(x.r.status, 0, x.out)
  assert.equal(x.firstParent, 2, 'the merge, then one commit')
  assert.equal(fx.git('rev-parse', 'work~1').stdout.trim(), merge, "the tip's first parent is the merge")
  assert.equal(x.parents, 1)
  assert.match(x.outputs, /^revised=1$/m)
  assert.equal(count(x.comments, '----'), 1, x.comments)
  assert.match(x.comments, /Revised from/)
  assert.ok(x.comments.includes(fx.git('rev-parse', '--short', 'work').stdout.trim()), 'names the tip')
  assert.match(x.comments, /w\.txt/)
  assert.equal(fx.git('show', `${merge}:w.txt`).stdout, 'w\nepic w\n', 'the merge holds only the resolution')
})

test('10 conflict and no requested edit -> merge only, not made, revise_noop=1 (#3775)', () => {
  const fx = fixture({ epicConflict: true })
  const merge = conflictMerge(fx)
  const x = runStep(fx, { slice: SLICE_5B, env: { REV_BASE: merge, REV_CONFLICT: '1', BASE_MERGED: merge } })
  assert.equal(x.r.status, 0, x.out)
  assert.equal(x.firstParent, 1, 'the merge only')
  assert.equal(x.parents, 2, 'a two-parent merge')
  assert.match(x.outputs, /^revise_noop=1$/m)
  assert.doesNotMatch(x.outputs, /^revised=1$/m)
  assert.equal(count(x.comments, '----'), 1, x.comments)
  assert.match(x.comments, /Brought up to date/)
  assert.match(x.comments, /was not made/)
  assert.doesNotMatch(x.comments, /no other change/)
})
