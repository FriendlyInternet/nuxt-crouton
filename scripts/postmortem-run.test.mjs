// postmortem.yml's I/O (#3425), driven through target() and post() — the functions the workflow runs —
// with a recording fake of the github-script octokit (no network in CI's node --test job).
//   node --test scripts/postmortem-run.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { target, post } from './postmortem-run.mjs'
import { renderPending, postmortemState } from './postmortem.mjs'

const harness = body => ({ body, user: { login: 'nuxt-harness[bot]', type: 'Bot' }, author_association: 'NONE' })
const actions = body => ({ body, user: { login: 'github-actions[bot]', type: 'Bot' }, author_association: 'CONTRIBUTOR' })
const outsider = body => ({ body, user: { login: 'x', type: 'User' }, author_association: 'NONE' })

function world({ labels = ['epic'], kids = [{ number: 1, state: 'closed' }], comments = [], state = 'open', parent = 7, pulls = [] } = {}) {
  const calls = []
  const outputs = {}
  const listComments = Symbol('listComments')
  const github = {
    paginate: async route => {
      if (route === listComments) return comments
      if (String(route).includes('/sub_issues')) return kids
      throw new Error(`unexpected paginate ${String(route)}`)
    },
    request: async (route, p) => {
      if (route.endsWith('/parent')) {
        if (parent == null) { const e = new Error('No parent issue found'); e.status = 404; throw e }
        return { data: { number: parent } }
      }
      throw new Error(`unexpected request ${route} ${JSON.stringify(p)}`)
    },
    rest: {
      issues: {
        get: async () => ({ data: { state, labels: labels.map(name => ({ name })) } }),
        listComments,
        createComment: async p => { calls.push(['comment', p.body]); comments.push(harness(p.body)); return { data: {} } },
        update: async p => { calls.push(['update', p.state, p.state_reason]); return { data: {} } },
        removeLabel: async p => { calls.push(['removeLabel', p.name]) },
        addLabels: async p => { calls.push(['addLabels', ...p.labels]) },
      },
      pulls: { list: async () => ({ data: pulls }) },
    },
  }
  const context = { repo: { owner: 'o', repo: 'r' } }
  const core = { info: () => {}, warning: () => {}, setOutput: (k, v) => { outputs[k] = v } }
  return { ctx: { github, context, core }, calls, outputs }
}
const modelFile = text => {
  const f = join(mkdtempSync(join(tmpdir(), 'pm-')), 'postmortem.md')
  if (text != null) writeFileSync(f, text)
  return f
}
const GOOD = '## What went well\n' + 'Evidence-backed retro line. '.repeat(12) + '\n## 🔭 Next\nnext epic'

test('target: a closed sub-issue resolves to its epic; done epic → go', async () => {
  const w = world()
  await target(w.ctx, { closedIssue: '3' })
  assert.deepEqual(w.outputs, { go: 'true', epic: '7' })
})
test('target: a closed issue with no parent stops there', async () => {
  const w = world({ parent: null })
  await target(w.ctx, { closedIssue: '3' })
  assert.equal(w.outputs.go, 'false')
})
test('target: the epic → main merge resolves the epic from the branch name; open kid → no go', async () => {
  const w = world({ kids: [{ number: 1, state: 'open' }] })
  await target(w.ctx, { headRef: 'epic/7-thing' })
  assert.deepEqual(w.outputs, { go: 'false', epic: '7' })
})

test('post: a good body → posted with the marker, labels flipped (remove-then-add), nothing closed without a pending marker', async () => {
  const w = world()
  await post(w.ctx, { epic: '7', modelFile: modelFile(GOOD), runUrl: 'u' })
  const c = w.calls.find(x => x[0] === 'comment')
  assert.equal(c[1].split('\n')[0], '<!-- postmortem:done epic=#7 -->')
  const labelCalls = w.calls.filter(x => x[0] === 'removeLabel' || x[0] === 'addLabels').map(x => x.join(':'))
  assert.deepEqual(labelCalls, ['removeLabel:status:needs-postmortem', 'removeLabel:status:ready-to-close', 'addLabels:status:ready-to-close'])
  assert.ok(!w.calls.some(x => x[0] === 'update'))
})
test('post: no model output → skipped note with the run link, and a /close-epic pending epic still closes', async () => {
  const w = world({ comments: [harness(renderPending({ epic: 7, via: 'close-epic' }))] })
  await post(w.ctx, { epic: '7', modelFile: modelFile(null), runUrl: 'https://run/1' })
  const notes = w.calls.filter(x => x[0] === 'comment').map(x => x[1])
  assert.equal(postmortemState([harness(notes[0])]), 'skipped')
  assert.match(notes[0], /https:\/\/run\/1/)
  assert.deepEqual(w.calls.find(x => x[0] === 'update'), ['update', 'closed', 'completed'])
})
test('post: a verified pending epic closes once its PR is merged and the postmortem posts', async () => {
  const w = world({ comments: [actions(renderPending({ epic: 7, via: 'verified' }))], pulls: [{ number: 9, state: 'closed', merged_at: 'x', head: { ref: 'epic/7-x' } }] })
  await post(w.ctx, { epic: '7', modelFile: modelFile(GOOD), runUrl: 'u' })
  assert.deepEqual(w.calls.find(x => x[0] === 'update'), ['update', 'closed', 'completed'])
})
test('post: a verified pending epic whose sub-issue was reopened stays open and says why', async () => {
  const w = world({ kids: [{ number: 4, state: 'open' }], comments: [actions(renderPending({ epic: 7, via: 'verified' }))] })
  await post(w.ctx, { epic: '7', modelFile: modelFile(GOOD), runUrl: 'u' })
  assert.ok(!w.calls.some(x => x[0] === 'update'))
  assert.ok(w.calls.some(x => x[0] === 'comment' && /#4/.test(x[1])))
})
test('post: a pending marker planted by an outsider never closes the epic', async () => {
  const w = world({ comments: [outsider(renderPending({ epic: 7, via: 'close-epic' }))] })
  await post(w.ctx, { epic: '7', modelFile: modelFile(GOOD), runUrl: 'u' })
  assert.ok(!w.calls.some(x => x[0] === 'update'))
})
test('post: a postmortem already there (race) → posts nothing new', async () => {
  const w = world({ comments: [harness('<!-- postmortem:done epic=#7 -->\nretro')] })
  await post(w.ctx, { epic: '7', modelFile: modelFile(GOOD), runUrl: 'u' })
  assert.ok(!w.calls.some(x => x[0] === 'comment'))
})
test('post: a GitHub error while posting still records skipped and closes (never blocks)', async () => {
  const w = world({ comments: [harness(renderPending({ epic: 7, via: 'close-epic' }))] })
  const real = w.ctx.github.rest.issues.createComment
  let first = true
  w.ctx.github.rest.issues.createComment = async p => { if (first) { first = false; throw new Error('HTTP 502') } return real(p) }
  await post(w.ctx, { epic: '7', modelFile: modelFile(GOOD), runUrl: 'u' })
  assert.ok(w.calls.some(x => x[0] === 'comment' && /postmortem:skipped/.test(x[1])))
  assert.deepEqual(w.calls.find(x => x[0] === 'update'), ['update', 'closed', 'completed'])
})
