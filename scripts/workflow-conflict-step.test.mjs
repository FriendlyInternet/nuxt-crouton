// The revise worker's `conflict` step + the Artifact-gate skips (#3322): run the real YAML scripts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const YML = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8').split('\n')

/** The block scalar (`run: |` / `script: |`) that follows the first line matching `anchor` after `from`. */
function block(anchor, key, from = 0) {
  let i = YML.findIndex((l, n) => n >= from && l.includes(anchor))
  assert.ok(i >= 0, anchor)
  while (!new RegExp(`^\\s+${key}: \\|`).test(YML[i])) i++
  const indent = YML[i + 1].match(/^ */)[0].length
  const out = []
  for (i++; i < YML.length && (YML[i] === '' || YML[i].match(/^ */)[0].length >= indent); i++) out.push(YML[i].slice(indent))
  return out.join('\n')
}
const STEP = block('- id: conflict', 'run')

// scenarios: files = { name: 'resolved' | 'markers' }, verify = { rc, err, choice }
function run({ files, verify }) {
  const dir = mkdtempSync(join(tmpdir(), 'cstep-'))
  const bin = join(dir, 'bin'); mkdirSync(bin)
  const log = join(dir, 'gh.log'); const out = join(dir, 'out.txt'); const tmp = join(dir, 'tmp'); mkdirSync(tmp)
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  const put = (f, t) => writeFileSync(join(dir, f), t)
  for (const f of Object.keys(files)) put(f, 'one\n')
  git('add', '-A'); git('commit', '-qm', 'b0')
  git('checkout', '-qb', 'work'); for (const f of Object.keys(files)) put(f, 'one\nside\n'); git('commit', '-qam', 's')
  git('checkout', '-q', 'main'); for (const f of Object.keys(files)) put(f, 'one\nbase\n'); git('commit', '-qam', 'm')
  git('checkout', '-q', 'work'); git('merge', '--no-edit', 'main')
  for (const [f, s] of Object.entries(files)) if (s === 'resolved') put(f, 'one\nbase\nside\n')
  writeFileSync(join(bin, 'gh'), `#!/bin/bash\nif [ "$1 $2" = "pr list" ]; then echo 42; exit 0; fi\nif [ "$1 $2" = "pr comment" ]; then printf '%s\\n----\\n' "$5" >> "${log}"; exit 0; fi\necho "$@" >> "${log}"\n`)
  // stub only verify: the step calls `node <script> verify <choice>`
  writeFileSync(join(bin, 'node'), `#!/bin/bash\nif [ "$2" = verify ]; then ${verify.choice ? `echo ${JSON.stringify(verify.choice)} > "$3";` : ''} echo ${JSON.stringify(verify.err || '')} >&2; ${verify.rc === 0 ? 'git add -u; echo a.md;' : ''} exit ${verify.rc}; fi\nexec ${process.execPath} "$@"\n`)
  chmodSync(join(bin, 'gh'), 0o755); chmodSync(join(bin, 'node'), 0o755)
  writeFileSync(join(dir, 'step.sh'), STEP)
  const r = spawnSync('bash', ['-e', join(dir, 'step.sh')], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: tmp, GITHUB_OUTPUT: out, GH_TOKEN: 'x', ISSUE: '1', BASE: 'main', REV_BRANCH: 'work', EPIC_BRANCH: '' },
  })
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
  return { r, comments: read(log), outputs: read(out), merging: existsSync(join(dir, '.git/MERGE_HEAD')), parents: git('rev-list', '--parents', '-n1', 'HEAD').stdout.trim().split(' ').length }
}

test('resolved file but verify fails its whitespace check: real reason, no #3002, failed=1', () => {
  const x = run({ files: { 'x.md': 'resolved' }, verify: { rc: 1, err: '::error::git diff --check: x.md:3: trailing whitespace' } })
  assert.equal(x.r.status, 1)
  assert.match(x.comments, /x\.md:3: trailing whitespace/)
  assert.match(x.comments, /did not pass its checks/)
  assert.doesNotMatch(x.comments, /#3002/)
  assert.equal(x.merging, false)
  assert.match(x.outputs, /failed=1/)
})

test('single file still with markers: the #3002 text, failed=1', () => {
  const x = run({ files: { 'x.md': 'markers' }, verify: { rc: 1, err: '::error::conflict markers remain in: x.md' } })
  assert.equal(x.r.status, 1)
  assert.match(x.comments, /#3002/)
  assert.match(x.outputs, /failed=1/)
})

test('two files, one resolved one not: names the unresolved one, no #3002', () => {
  const x = run({ files: { 'ok.md': 'resolved', 'bad.md': 'markers' }, verify: { rc: 1, err: '::error::conflict markers remain in: bad.md' } })
  assert.equal(x.r.status, 1)
  assert.match(x.comments, /`bad\.md` — still has conflict markers/)
  assert.doesNotMatch(x.comments, /`ok\.md` — still has/)
  assert.doesNotMatch(x.comments, /#3002/)
  assert.match(x.outputs, /failed=1/)
})

test('owner must choose (exit 3): 🔀 on the PR, status:blocked, asked=1, exit 0', () => {
  const x = run({ files: { 'x.md': 'markers' }, verify: { rc: 3, choice: 'A wants foo, B wants bar' } })
  assert.equal(x.r.status, 0)
  assert.match(x.comments, /🔀 Blocked/)
  assert.match(x.comments, /\*\*Needs:\*\* answer/)
  assert.match(x.comments, /A wants foo/)
  assert.match(x.comments, /issue edit 1 --add-label status:blocked/)
  assert.match(x.outputs, /asked=1/)
})

test('clean verify: one two-parent commit, no failure comment, no flags', () => {
  const x = run({ files: { 'a.md': 'resolved' }, verify: { rc: 0 } })
  assert.equal(x.r.status, 0, x.r.stderr)
  assert.equal(x.parents, 3)
  assert.doesNotMatch(x.comments, /did not pass|#3002/)
  assert.doesNotMatch(x.outputs, /failed=1|asked=1/)
})

// ── Artifact-gate skips ──
import { artifactGate } from './lib/artifact-gate.mjs'

async function gate(env) {
  const calls = { failed: [], info: [] }
  const boom = () => { throw new Error('reached the ticket-comment path') }
  const core = { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m) }
  const github = { paginate: boom, rest: { issues: { listComments: boom, createComment: boom } } }
  const keys = ['ISSUE_NUMBER', 'PLAN_OK', 'REVISE_CONFLICT', 'REVISED', 'CONFLICT_ASKED', 'CONFLICT_FAILED']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  for (const k of keys) delete process.env[k]
  Object.assign(process.env, { ISSUE_NUMBER: '1' }, env)
  try {
    await artifactGate({ github, context: { repo: {} }, core, env: process.env })
  } finally { for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]) }
  return calls
}

test('gate: conflict asked the owner -> OK, no failure, no ticket comment', async () => {
  const c = await gate({ CONFLICT_ASKED: '1' })
  assert.equal(c.failed.length, 0)
  assert.equal(c.info.length, 1)
})

test('gate: conflict failed -> run fails, but no ticket comment', async () => {
  const c = await gate({ CONFLICT_FAILED: '1' })
  assert.equal(c.failed.length, 1)
})
