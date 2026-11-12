// The fix-bot guard (#2719), moved out of fix-ci-on-failure.yml into scripts/fix-bot-guard.sh (#3452).
// Runs the real script — read from the default branch exactly as the workflow step does — against
// throwaway git repos: no fix → nothing pushed; a fix that only adds → pushed; a fix that deletes a
// line the worker added → refused, branch reset, hand-back listing the line. `gh` is a PATH stub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'fix-guard-'))
  const origin = join(root, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  const work = join(root, 'work')
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'ignore' })
  for (const [k, v] of [['user.name', 'x'], ['user.email', 'x@x']]) git(work, 'config', k, v)
  git(work, 'checkout', '-q', '-b', 'main')
  mkdirSync(join(work, 'scripts/lib'), { recursive: true })
  for (const f of ['fix-bot-guard.sh', 'git-push-retry.mjs', 'revert-pushed-fix.sh', 'lib/fix-removes-worker-code.mjs']) {
    copyFileSync(join(ROOT, 'scripts', f), join(work, 'scripts', f))
  }
  writeFileSync(join(work, 'app.js'), 'const a = 1\n')
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'base'); git(work, 'push', '-q', 'origin', 'main')
  git(work, 'checkout', '-q', '-b', 'feature')
  writeFileSync(join(work, 'app.js'), 'const a = 1\nconst workerLine = compute(a)\n')
  git(work, 'commit', '-qam', 'worker'); git(work, 'push', '-q', 'origin', 'feature')
  const pre = git(work, 'rev-parse', 'HEAD')
  const temp = join(root, 'temp'); mkdirSync(temp)
  writeFileSync(join(temp, 'failed-job-logs.md'), 'Error: compute is not defined\n')
  const bin = join(root, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> "${join(root, 'gh.log')}"\necho "https://github.com/o/r/pull/1#issuecomment-99"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  return { root, work, pre, temp, bin }
}

// The workflow step, verbatim in effect: fetch the default branch, read the script from it, run it.
function guard({ root, work, pre, temp, bin }) {
  const out = join(root, 'github-output'); writeFileSync(out, '')
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, GITHUB_OUTPUT: out, DEFAULT_BRANCH: 'main',
    PRE: pre, BASE: 'main', BRANCH: 'feature', PR: '1', ISSUE: '', RUN_URL: 'https://run', RUN_NAME: 'CI' }
  const step = readFileSync(join(ROOT, '.github/workflows/fix-ci-on-failure.yml'), 'utf8')
  const body = /- name: Guard and push the fix[\s\S]*?run: \|\n([\s\S]*?)\n\s*\n/.exec(step)[1].split('\n').map(l => l.replace(/^ {10}/, '')).join('\n')
  const r = spawnSync('bash', ['-c', body], { cwd: work, env, encoding: 'utf8' })
  return { ...r, output: readFileSync(out, 'utf8'), gh: existsSync(join(root, 'gh.log')) ? readFileSync(join(root, 'gh.log'), 'utf8') : '' }
}

test('the workflow guard step runs scripts/fix-bot-guard.sh from the default branch, inline block under the size limit', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/fix-ci-on-failure.yml'), 'utf8')
  const body = /- name: Guard and push the fix[\s\S]*?run: \|\n([\s\S]*?)\n\s*\n/.exec(yml)[1]
  assert.match(body, /git show "origin\/\$DEFAULT_BRANCH:scripts\/fix-bot-guard\.sh"/)
  assert.ok(body.split('\n').length < 40, 'the guard run: block stays below the #3452 limit')
})

test('no fix commit → exit 0, nothing pushed, no comment when there is no issue', () => {
  const s = setup()
  const r = guard(s)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /No fix commit/)
  assert.equal(git(s.work, 'rev-parse', 'origin/feature'), s.pre)
  assert.equal(r.gh, '')
})

test('a fix that only adds lines → pushed to the PR branch, not refused', () => {
  const s = setup()
  writeFileSync(join(s.work, 'app.js'), 'const compute = (x) => x\nconst a = 1\nconst workerLine = compute(a)\n')
  git(s.work, 'commit', '-qam', 'fix: define compute')
  const head = git(s.work, 'rev-parse', 'HEAD')
  const r = guard(s)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(git(s.work, 'ls-remote', 'origin', 'refs/heads/feature').split('\t')[0], head)
  assert.doesNotMatch(r.output, /refused=true/)
})

test('a fix that deletes a worker-added line → refused, reset to PRE, hand-back lists the line', () => {
  const s = setup()
  writeFileSync(join(s.work, 'app.js'), 'const a = 1\n')
  git(s.work, 'commit', '-qam', 'fix: drop stray line')
  const r = guard(s)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.output, /refused=true/)
  assert.equal(git(s.work, 'rev-parse', 'HEAD'), s.pre, 'local branch reset to the pre-fix head')
  assert.equal(git(s.work, 'ls-remote', 'origin', 'refs/heads/feature').split('\t')[0], s.pre, 'nothing pushed')
  const hb = readFileSync(join(s.temp, 'handback.md'), 'utf8')
  assert.equal(hb.split('\n')[0], '<!-- pipeline-note -->')
  assert.match(hb, /- `app\.js`: `const workerLine = compute\(a\)`/)
  assert.match(hb, /Error: compute is not defined/)
  assert.match(r.gh, /pr comment 1 --body-file .*handback\.md/)
})

// #3668 review: the hand-back carries the failing line, so the worker's next head keeps the try count.
test('a refused fix → the hand-back carries a hidden marker with the failing line (from the default-branch lib)', async () => {
  const s = setup()
  mkdirSync(join(s.temp, 'lib')); mkdirSync(join(s.temp, 'raw-logs'))
  for (const f of ['diagnosis-review', 'log-tail', 'diagnosis-marker', 'ci-fix-commit', 'failed-job-logs']) copyFileSync(join(ROOT, 'scripts/lib', `${f}.mjs`), join(s.temp, 'lib', `${f}.mjs`))
  const line = '2026-11-11T10:00:00.0000000Z ##[error]app.js(2,20): error TS2304: Cannot find name \'compute\'.'
  writeFileSync(join(s.temp, 'raw-logs', '7.log'), `2026-11-11T09:59:59.0000000Z Run pnpm typecheck\n${line}\n`)
  writeFileSync(join(s.work, 'app.js'), 'const a = 1\n')
  git(s.work, 'commit', '-qam', 'fix: drop stray line')
  const r = guard(s)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.output, /refused=true/)
  const hb = readFileSync(join(s.temp, 'handback.md'), 'utf8').split('\n')
  assert.equal(hb[0], '<!-- pipeline-note -->')
  const { parseHandbackMarker, normaliseLine, firstFailingLines } = await import('./lib/diagnosis-review.mjs')
  assert.deepEqual(parseHandbackMarker(hb[1]), { sha: s.pre, check: 'CI', line: normaliseLine(firstFailingLines([line])[0]) })
})
