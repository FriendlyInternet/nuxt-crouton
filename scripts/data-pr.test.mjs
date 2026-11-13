import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/data-pr.sh')
const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
}
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()

function fixture(stubEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'datapr-'))
  const origin = join(root, 'origin.git'), work = join(root, 'work'), bin = join(root, 'bin')
  git(root, 'init', '--bare', '-b', 'main', origin)
  git(root, 'clone', origin, work)
  writeFileSync(join(work, 'f.txt'), 'a\n')
  git(work, 'add', '.'); git(work, 'commit', '-m', 'init'); git(work, 'push', 'origin', 'HEAD:main')
  mkdirSync(bin)
  const log = join(root, 'gh.log'), counter = join(root, 'count')
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1 $2" in
  "pr list") echo "\${STUB_PR_LIST:-[]}" ;;
  "pr view")
    if [[ "$*" == *mergeStateStatus* ]]; then
      n=$(cat "${counter}" 2>/dev/null || echo 0); echo $((n+1)) > "${counter}"
      IFS=, read -ra S <<< "\${STUB_STATES:-CLEAN}"
      i=$n; [ $i -ge \${#S[@]} ] && i=$((\${#S[@]}-1))
      echo "{\\"mergeStateStatus\\":\\"\${S[$i]}\\"}"
    elif [ -n "\$STUB_VIEW" ]; then echo "\$STUB_VIEW"
    else echo '{"number":7,"state":"OPEN","autoMergeRequest":{"enabledAt":"x"}}'; fi ;;
esac
exit 0
`)
  chmodSync(join(bin, 'gh'), 0o755)
  const env = { ...process.env, ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, DATA_PR_POLL_MS: '1', ...stubEnv }
  const run = (...a) => spawnSync('bash', [SCRIPT, ...a], { cwd: work, env, encoding: 'utf8' })
  const ghLog = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  return { root, origin, work, run, ghLog }
}
const remoteHas = (f, b) => spawnSync('git', ['--git-dir', f.origin, 'rev-parse', '--verify', b]).status === 0

test('new branch from main, PR created and auto-merge requested', () => {
  const f = fixture()
  assert.equal(f.run('start', 'x').status, 0)
  writeFileSync(join(f.work, 'f.txt'), 'b\n')
  const r = f.run('publish', 'x', 't', 'f.txt')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(remoteHas(f, 'data/x'))
  assert.match(f.ghLog(), /pr create --base main --head data\/x/)
  assert.match(f.ghLog(), /pr merge data\/x --auto --merge/)
  assert.match(r.stdout, /data-pr: auto-merge on/)
})

test('reuses open branch: earlier commit kept, no pr create', () => {
  const f = fixture({ STUB_PR_LIST: '[{"number":3}]' })
  f.run('start', 'x')
  writeFileSync(join(f.work, 'f.txt'), 'b\n')
  assert.equal(f.run('publish', 'x', 'first', 'f.txt').status, 0)
  f.run('start', 'x')
  assert.equal(git(f.work, 'log', '-1', '--format=%s'), 'first')
  writeFileSync(join(f.work, 'f.txt'), 'c\n')
  assert.equal(f.run('publish', 'x', 'second', 'f.txt').status, 0)
  assert.doesNotMatch(f.ghLog(), /pr create/)
  assert.match(f.ghLog(), /pr merge data\/x --auto/)
})

test('no change is a visible no-op', () => {
  const f = fixture()
  f.run('start', 'x')
  const r = f.run('publish', 'x', 't', 'f.txt')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /data-pr: no change/)
  assert.ok(!remoteHas(f, 'data/x'))
  assert.equal(f.ghLog(), '')
})

test('never [skip ci] in the commit subject', () => {
  const f = fixture()
  f.run('start', 'x')
  writeFileSync(join(f.work, 'f.txt'), 'b\n')
  f.run('publish', 'x', 'chore: sync [skip ci]', 'f.txt')
  const subj = execFileSync('git', ['--git-dir', f.origin, 'log', '-1', '--format=%s', 'data/x'], { encoding: 'utf8' }).trim()
  assert.equal(subj, 'chore: sync')
})

test('refuses unsafe names', () => {
  const f = fixture()
  const before = execFileSync('git', ['--git-dir', f.origin, 'rev-parse', 'main'], { encoding: 'utf8' })
  for (const n of ['main', '../main']) assert.notEqual(f.run('publish', n, 't', 'f.txt').status, 0)
  assert.equal(execFileSync('git', ['--git-dir', f.origin, 'rev-parse', 'main'], { encoding: 'utf8' }), before)
})

test('fails loudly when neither merged nor auto-merge', () => {
  const f = fixture({ STUB_VIEW: '{"number":9,"state":"OPEN","autoMergeRequest":null}' })
  f.run('start', 'x')
  writeFileSync(join(f.work, 'f.txt'), 'b\n')
  const r = f.run('publish', 'x', 't', 'f.txt')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /PR 9/)
})

test('merging right away counts', () => {
  const f = fixture({ STUB_VIEW: '{"number":9,"state":"MERGED","autoMergeRequest":null}' })
  f.run('start', 'x')
  writeFileSync(join(f.work, 'f.txt'), 'b\n')
  const r = f.run('publish', 'x', 't', 'f.txt')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /data-pr: merged/)
})

test('waits out UNKNOWN before merging', () => {
  const f = fixture({ STUB_STATES: 'UNKNOWN,UNKNOWN,BLOCKED' })
  f.run('start', 'x')
  writeFileSync(join(f.work, 'f.txt'), 'b\n')
  const r = f.run('publish', 'x', 't', 'f.txt')
  assert.equal(r.status, 0, r.stderr)
  const lines = f.ghLog().trim().split('\n')
  const polls = lines.filter(l => l.includes('mergeStateStatus')).length
  assert.equal(polls, 3)
  assert.equal(lines.filter(l => l.startsWith('pr merge')).length, 1)
  assert.ok(lines.findIndex(l => l.startsWith('pr merge')) > lines.map(l => l.includes('mergeStateStatus')).lastIndexOf(true))
  assert.match(r.stdout, /data-pr: auto-merge on/)
})
