// worker-question.mjs (#4192): the step after `finish` posts the worker's question for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseQuestion, questionComment, postWorkerQuestion } from './worker-question.mjs'
import { readRecord } from './reply-record.mjs'

const Q = "## 🔀 Blocked — velo won't build: A or B? I recommend A\n**Needs:** answer\n\nA — default it off.\nB — upgrade drizzle.\n<details>state</details>\n"

/** A fake gh: records calls; `pr` is what `pr list` prints; `fail` names a subcommand that throws. */
function fakeGh({ pr = '', fail = '' } = {}) {
  const calls = []
  const gh = (args) => {
    calls.push(args)
    const sub = `${args[0]} ${args[1]}`
    if (sub === fail) throw new Error(`${sub} failed`)
    if (sub === 'pr list') return pr
    return ''
  }
  return { gh, calls }
}
function fakeFs(files = {}) {
  const written = {}
  return { written, fs: { exists: (p) => p in files, readFile: (p) => files[p], writeFile: (p, s) => { written[p] = s } } }
}
const run = (opts) => postWorkerQuestion({ issue: 4192, owner: 'pmcp', log: () => {}, ...opts })

test('parseQuestion: lead stripped of heading/🔀/Blocked, Needs read, rest kept', () => {
  const q = parseQuestion(Q)
  assert.equal(q.lead, "velo won't build: A or B? I recommend A")
  assert.equal(q.needs, 'answer')
  assert.ok(q.rest.startsWith('A — default it off.'))
  assert.ok(!q.rest.includes('**Needs:**'))
  assert.equal(parseQuestion('  \n\n'), null)
  assert.equal(parseQuestion('Pick one\nno needs line').needs, 'answer')
})

// covers: T1
test('file + open PR → comment with a worker-question record + status:blocked', () => {
  const { gh, calls } = fakeGh({ pr: '77\n' })
  const { fs, written } = fakeFs({ '/rt/q.md': Q })
  const r = run({ file: '/rt/q.md', gh, fs })
  assert.deepEqual(r, { posted: true, record: true, code: 0 })
  const body = written['/rt/q.md.comment.md']
  const rec = readRecord(body)
  assert.equal(rec.kind, 'worker-question')
  assert.deepEqual(rec.accepts, ['other'])
  assert.deepEqual(rec.starts, { other: 'answer-worker' })
  assert.equal(rec.question, "velo won't build: A or B? I recommend A")
  assert.match(body, /\n> 🤖 \*\*pi\.dev harness\*\* · agent pipeline \(CI\)/)
  assert.match(body, /## 🔀 Blocked — velo won't build/)
  assert.match(body, /\*\*Needs:\*\* answer/)
  assert.match(body, /@pmcp A — default/)
  assert.deepEqual(calls[0], ['pr', 'list', '--head', 'work-4192', '--state', 'open', '--json', 'number', '-q', '.[0].number'])
  assert.deepEqual(calls[1], ['issue', 'comment', '4192', '--body-file', '/rt/q.md.comment.md'])
  assert.deepEqual(calls[2], ['issue', 'edit', '4192', '--add-label', 'status:blocked'])
})

// covers: T1
test('file + no open PR (empty, or a failed lookup) → comment without a record + status:blocked', () => {
  for (const g of [fakeGh({ pr: '' }), fakeGh({ fail: 'pr list' })]) {
    const { fs, written } = fakeFs({ '/rt/q.md': Q })
    const r = run({ file: '/rt/q.md', gh: g.gh, fs })
    assert.deepEqual(r, { posted: true, record: false, code: 0 })
    assert.equal(readRecord(written['/rt/q.md.comment.md']), null)
    assert.ok(written['/rt/q.md.comment.md'].startsWith('> 🤖'))
    assert.ok(g.calls.some((a) => a[0] === 'issue' && a[1] === 'edit'))
  }
})

// covers: T1
test('no file / blank file → nothing posted', () => {
  for (const files of [{}, { '/rt/q.md': '  \n' }]) {
    const { gh, calls } = fakeGh({ pr: '77' })
    const { fs } = fakeFs(files)
    assert.deepEqual(run({ file: '/rt/q.md', gh, fs }), { posted: false, record: false, code: 0 })
    assert.equal(calls.length, 0)
  }
})

// covers: T1
test('**Needs:** action file + open PR → no record (not a question to send back)', () => {
  const c = questionComment({ text: '## 🔀 Blocked — add the workflows scope\n**Needs:** action\n\n@pmcp please', prOpen: true, owner: 'pmcp' })
  assert.equal(c.record, false)
  assert.equal(readRecord(c.body), null)
  assert.match(c.body, /\*\*Needs:\*\* action/)
  assert.ok(!c.body.includes('@pmcp @pmcp'), 'no second mention when the text already has one')
})

// covers: T1
test('failed post → exit 1; failed label → exit 1', () => {
  for (const fail of ['issue comment', 'issue edit']) {
    const { gh } = fakeGh({ pr: '77', fail })
    const { fs } = fakeFs({ '/rt/q.md': Q })
    const logs = []
    const r = postWorkerQuestion({ file: '/rt/q.md', issue: 4192, owner: 'pmcp', gh, fs, log: (m) => logs.push(m) })
    assert.equal(r.code, 1, fail)
    assert.ok(logs.some((l) => l.startsWith('::error::')), fail)
  }
})

// covers: T1
test('work-issue-pidev.yml has a `question` step after `finish` running the pi-run copy', () => {
  const wf = readFileSync(new URL('../../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
  const finish = wf.indexOf('      - id: finish\n')
  const q = wf.indexOf('      - id: question\n')
  const held = wf.indexOf('      - id: held\n')
  const gate = wf.indexOf('Artifact-gate — fail if the agent produced nothing')
  assert.ok(finish > 0 && q > finish && q < held && q < gate, 'question sits after finish, before held and the artifact gate')
  const step = wf.slice(q, held)
  assert.ok(step.includes("if: ${{ !cancelled() && steps.claim.outcome != 'failure' && inputs.mode != 'plan' }}"))
  assert.ok(step.includes('run: node "$RUNNER_TEMP/pi-run/scripts/lib/worker-question.mjs" "$RUNNER_TEMP/worker-question.md"'))
  assert.ok(step.includes('GH_TOKEN: ${{ steps.app-token.outputs.token }}'))
  assert.ok(step.includes('ISSUE: ${{ inputs.issue || github.event.issue.number }}'))
  assert.ok(step.includes("OWNER_LOGIN: ${{ vars.PIPELINE_OWNER || 'pmcp' }}"))
})
