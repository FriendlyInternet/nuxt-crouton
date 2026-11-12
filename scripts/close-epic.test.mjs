// `/close-epic` (#856, #3425): who may close, which labels it needs, and when it starts the postmortem
// instead of refusing. Also drives runCloseEpic — the code on-comment.yml runs — with a fake octokit.
//   node --test scripts/close-epic.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideCloseEpic, refuseBody, runCloseEpic } from './close-epic.mjs'
import { pendingClose } from './postmortem.mjs'

const both = ['epic', 'status:ready-to-close']

test('refuse without push access', () => {
  assert.equal(decideCloseEpic({ labels: both, perm: 'read' }).action, 'ignore')
  assert.equal(decideCloseEpic({ labels: both, perm: 'none' }).action, 'ignore')
})
test('refuse missing epic label', () => {
  assert.deepEqual(decideCloseEpic({ labels: ['status:ready-to-close'], perm: 'write', postmortemGo: true }), { action: 'refuse', missing: ['epic'] })
})
test('missing ready-to-close + done epic → pending', () => {
  assert.deepEqual(decideCloseEpic({ labels: ['epic'], perm: 'admin', postmortemGo: true }), { action: 'pending' })
})
test('missing ready-to-close + a postmortem already running → no second start', () => {
  assert.deepEqual(decideCloseEpic({ labels: ['epic'], perm: 'admin', postmortemGo: true, pending: 'verified' }), { action: 'already-pending' })
})
test('missing ready-to-close + open kids → refuse with the postmortem hint', () => {
  const d = decideCloseEpic({ labels: ['epic'], perm: 'write', postmortemGo: false })
  assert.deepEqual(d, { action: 'refuse', missing: ['status:ready-to-close'] })
  assert.match(refuseBody({ missing: d.missing, runUrl: 'u' }), /postmortem/)
})
test('both labels → close', () => {
  assert.deepEqual(decideCloseEpic({ labels: both, perm: 'write' }), { action: 'close' })
})
test('an already-closed epic is ignored', () => {
  assert.equal(decideCloseEpic({ labels: both, perm: 'admin', state: 'closed' }).action, 'ignore')
})

// The production entry point, with a recording fake of the github-script octokit.
function fake({ labels, perm = 'admin', kids = [], comments = [] }) {
  const calls = []
  const github = {
    paginate: async (route, params) => {
      if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues') return kids
      if (route === github.rest.issues.listComments) return comments
      throw new Error(`unexpected paginate ${route}`)
    },
    rest: {
      issues: {
        get: async () => ({ data: { state: 'open', labels: labels.map(name => ({ name })) } }),
        listComments: Symbol('listComments'),
        createComment: async p => { calls.push(['comment', p.body]); return { data: {} } },
        update: async p => { calls.push(['update', p.state]); return { data: {} } },
        removeLabel: async p => { calls.push(['removeLabel', p.name]) },
      },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: perm } }) },
      actions: { createWorkflowDispatch: async p => { calls.push(['dispatch', p.workflow_id, p.inputs.epic]); return { status: 204 } } },
    },
  }
  const context = {
    payload: { issue: { number: 7 }, comment: { user: { login: 'pmcp' }, body: '/close-epic' } },
    repo: { owner: 'o', repo: 'r' }, serverUrl: 'https://github.com', runId: 1,
  }
  const core = { info: () => {} }
  return { github, context, core, calls }
}

test('runCloseEpic: done epic without postmortem → pending marker (bot-authored) + postmortem.yml started, not closed', async () => {
  const f = fake({ labels: ['epic'], kids: [{ number: 1, state: 'closed' }] })
  await runCloseEpic(f)
  const comment = f.calls.find(c => c[0] === 'comment')
  assert.ok(comment, 'posted the pending note')
  assert.equal(pendingClose([{ body: comment[1], user: { login: 'nuxt-harness[bot]', type: 'Bot' } }]), 'close-epic')
  assert.deepEqual(f.calls.find(c => c[0] === 'dispatch'), ['dispatch', 'postmortem.yml', '7'])
  assert.ok(!f.calls.some(c => c[0] === 'update'), 'not closed yet')
})
test('runCloseEpic: ready-to-close → closes and starts nothing', async () => {
  const f = fake({ labels: both })
  await runCloseEpic(f)
  assert.deepEqual(f.calls.find(c => c[0] === 'update'), ['update', 'closed'])
  assert.ok(!f.calls.some(c => c[0] === 'dispatch'))
})
test('runCloseEpic: open kids → refused with a reply, nothing started', async () => {
  const f = fake({ labels: ['epic'], kids: [{ number: 1, state: 'open' }] })
  await runCloseEpic(f)
  assert.match(f.calls.find(c => c[0] === 'comment')[1], /Not closed/)
  assert.ok(!f.calls.some(c => c[0] === 'dispatch' || c[0] === 'update'))
})
test('runCloseEpic: "/close-epically" is not the command', async () => {
  const f = fake({ labels: both })
  f.context.payload.comment.body = '/close-epically'
  await runCloseEpic(f)
  assert.equal(f.calls.length, 0)
})
