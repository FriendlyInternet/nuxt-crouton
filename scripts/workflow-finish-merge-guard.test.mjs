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

const SCRIPTS = new URL('.', import.meta.url).pathname

/**
 * Fixture: bare origin with main / epic / work; `mainFiles` extra files land on main after the
 * branch point. `prep(git, put)` runs on the work clone before the step (the "worker").
 */
function fixture({ mainFiles = 2, epicMoves = false } = {}) {
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
  sh(root, 'clone', '-q', '--bare', seed, origin)
  sh(root, 'clone', '-q', origin, dir)
  const git = (...a) => sh(dir, ...a)
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  git('checkout', '-q', 'work')
  const revStart = git('rev-parse', 'HEAD').stdout.trim()
  return { root, dir, git, revStart, put: (f, t) => writeFileSync(join(dir, f), t) }
}

function runStep(fx, { slice = SLICE, guard = null, comments = '' } = {}) {
  const { root, dir, revStart } = fx
  const bin = join(root, 'bin'); const tmp = join(root, 'tmp')
  mkdirSync(bin, { recursive: true }); mkdirSync(tmp, { recursive: true })
  const log = join(root, 'gh-comments.log'); const list = join(root, 'gh-list.txt'); const out = join(root, 'out.txt')
  writeFileSync(list, comments); writeFileSync(out, '')
  copyFileSync(join(SCRIPTS, 'revise-base.mjs'), join(tmp, 'revise-base.mjs'))
  if (guard) writeFileSync(join(tmp, 'revise-merge-guard.mjs'), guard)
  else copyFileSync(join(SCRIPTS, 'revise-merge-guard.mjs'), join(tmp, 'revise-merge-guard.mjs'))
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
      ISSUE: '1', BASE: 'epic', REV_START: revStart, REV_BRANCH: 'work', REV_CONFLICT: '', REV_BASE: '' },
  })
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
  const tip = fx.git('rev-parse', 'work').stdout.trim()
  return {
    r, out: r.stdout + r.stderr, comments: read(log), outputs: read(out), tip,
    newCommits: Number(fx.git('rev-list', '--count', `${revStart}..work`).stdout.trim()),
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
