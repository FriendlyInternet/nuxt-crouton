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

// covers: T8
test('the revise step copies log-tail beside the lone copy and records dist_ref before the checkout; conflict gets PKG_DIST_REF (#4374)', () => {
  const rev = block('- id: revise', 'run').split('\n')
  const checkout = rev.findIndex((l) => l.includes('git checkout -f -B'))
  const copy = rev.findIndex((l) => l.includes('cp scripts/lib/log-tail.mjs "$RUNNER_TEMP/lib/log-tail.mjs"'))
  const ref = rev.findIndex((l) => /^echo "dist_ref=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"$/.test(l.trim()))
  assert.ok(checkout >= 0, 'checkout line')
  assert.ok(copy >= 0 && copy < checkout, `log-tail copied before the checkout (${copy} < ${checkout})`)
  assert.ok(rev[copy].includes('mkdir -p "$RUNNER_TEMP/lib"'), rev[copy])
  assert.ok(ref >= 0 && ref < checkout, `dist_ref written before the checkout (${ref} < ${checkout})`)
  const at = YML.findIndex((l) => l.trim() === '- id: conflict')
  const end = YML.findIndex((l, n) => n > at && /^\s+run: \|/.test(l))
  assert.ok(YML.slice(at, end).some((l) => l.trim() === 'PKG_DIST_REF: ${{ steps.revise.outputs.dist_ref }}'), 'conflict env sets PKG_DIST_REF')
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

test("pi-request runs the owner's request only after the conflict merge is committed (#3775)", () => {
  const at = (id) => YML.findIndex((l) => l.trim() === `- id: ${id}`)
  const [conflict, request, finish] = [at('conflict'), at('pi-request'), at('finish')]
  assert.ok(conflict >= 0 && request > conflict && finish > request, `order conflict(${conflict}) < pi-request(${request}) < finish(${finish})`)
  const cond = YML.slice(request, request + 3).find((l) => l.trim().startsWith('if:'))
  assert.ok(cond, 'pi-request has an if:')
  assert.ok(cond.includes("steps.revise.outputs.conflict == '1'"), cond)
  assert.ok(cond.includes("steps.conflict.outputs.rev_base != ''"), 'skipped unless the conflict step committed a merge')
  const run = block('- id: pi-request', 'run')
  assert.match(run, /pipeline-prompt\.mjs pi-reviser [^\n]*--var-file "feedback=/)
  assert.match(run, /--session-dir "\$RUNNER_TEMP\/pi-session"/)
  assert.match(run, /tee -a "decompose-pidev-exec-/)
  // and the resolver itself is no longer handed the comment. The pi step builds its prompt in
  // scripts/pi-run.mjs (#3620), so check the vars buildPrompt hands the resolver persona.
  assert.match(block('- id: pi', 'run'), /node "\$RUNNER_TEMP\/pi-run\/scripts\/pi-run\.mjs" prompt > "\$PROMPT_FILE"/)
})

test('the conflict resolver prompt (scripts/pi-run.mjs buildPrompt) gets only pr/issue/branch/task, never feedback', async () => {
  const { buildPrompt } = await import('./pi-run.mjs')
  const rt = mkdtempSync(join(tmpdir(), 'conflict-prompt-'))
  writeFileSync(join(rt, 'feedback.txt'), 'OWNER-COMMENT-MARKER\n')
  writeFileSync(join(rt, 'conflict-task.txt'), 'merge conflicted in a.mjs\n')
  const calls = []
  const renderPrompt = (agent, vars) => { calls.push({ agent, vars }); return `${agent}:${JSON.stringify(vars)}` }
  const gh = () => '77\n'
  const out = await buildPrompt({ ISSUE: '1', REVISE: '1', REV_CONFLICT: '1', REV_BRANCH: 'epic/1--x', RUNNER_TEMP: rt, GITHUB_REPOSITORY: 'o/r' }, { gh, renderPrompt })
  assert.deepEqual(calls, [{ agent: 'pi-conflict-resolver', vars: { pr: '77', issue: '1', branch: 'epic/1--x', task: 'merge conflicted in a.mjs\n' } }])
  assert.doesNotMatch(out, /OWNER-COMMENT-MARKER/)
})
