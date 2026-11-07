// Contract for the pipeline-fix evidence check (#2657). Run: node --test scripts/fix-evidence.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceNeeded, findEvidence, mergedAt, main } from './fix-evidence.mjs'

test('evidenceNeeded reads the line, trims, strips backticks, null when absent', () => {
  assert.equal(evidenceNeeded('intro\nEvidence-needed: pi mcp: not blocked  \nmore'), 'pi mcp: not blocked')
  assert.equal(evidenceNeeded('Evidence-needed: `pi tools: ok`'), 'pi tools: ok')
  assert.equal(evidenceNeeded('no such line'), null)
  assert.equal(evidenceNeeded('Evidence-needed:   '), null)
  assert.equal(evidenceNeeded(null), null)
})

test('findEvidence matches title + ": " + message case-insensitively', () => {
  const anns = [{ title: 'pi tools', message: 'x' }, { title: 'pi mcp', message: 'Not Blocked' }]
  assert.equal(findEvidence('pi mcp: not blocked', anns), anns[1])
  assert.equal(findEvidence('absent', anns), null)
  assert.equal(findEvidence('', anns), null)
  assert.equal(findEvidence('x', []), null)
})

test('mergedAt takes the merged PR from cross-references, null when none merged', () => {
  const ev = m => ({ event: 'cross-referenced', source: { issue: { pull_request: { merged_at: m } } } })
  assert.equal(mergedAt([ev(null), ev('2026-10-26T10:00:00Z')]), '2026-10-26T10:00:00Z')
  assert.equal(mergedAt([ev(null), { event: 'labeled' }]), null)
})

// --- main(): call-count contract (#3387) ---
function fakeIo({ issues, timeline = [], run = { id: 99, created_at: '2026-11-02T00:00:00Z', html_url: 'http://run' }, annotations = [] }) {
  const calls = []
  return {
    calls,
    gh(path) {
      calls.push(path)
      if (path.includes('/issues?')) return issues
      if (path.includes('/timeline')) return timeline
      if (path.includes('/jobs')) return [{ jobs: [{ id: 7 }] }]
      if (path.includes('/annotations')) return annotations
      throw new Error(`unexpected ${path}`)
    },
    ghSend(args) {
      calls.push(args.join(' '))
      if (args[0] === 'api') return JSON.stringify(run)
      return ''
    },
  }
}
const pr = (m) => [{ event: 'cross-referenced', source: { issue: { pull_request: { merged_at: m } } } }]
const evIssue = { number: 5, body: 'Evidence-needed: pi: ok' }
async function runMain(io) {
  process.env.GITHUB_REPOSITORY = 'o/r'
  const logs = []
  const orig = console.log
  console.log = (...a) => { logs.push(a.join(" ")) }
  try { await main('99', io) } finally { console.log = orig }
  return logs
}

test('main reads only the issue list when no issue waits for evidence', async () => {
  const io = fakeIo({ issues: [{ number: 1, body: 'x' }, { number: 2, body: 'Evidence-needed: y', pull_request: {} }] })
  const logs = await runMain(io)
  assert.equal(io.calls.length, 1)
  assert.ok(logs.includes('no issue waits for evidence'))
})

test('main stops after the timeline when the fix is not merged', async () => {
  const io = fakeIo({ issues: [evIssue], timeline: pr(null) })
  await runMain(io)
  assert.equal(io.calls.length, 2)
})

test('main skips the jobs read when the run predates the merge', async () => {
  const io = fakeIo({ issues: [evIssue], timeline: pr('2026-11-03T00:00:00Z') })
  await runMain(io)
  assert.equal(io.calls.length, 3)
  assert.ok(!io.calls.some(c => c.includes('/jobs')))
})

test('main closes the issue when a merged fix\'s run shows the needle', async () => {
  const io = fakeIo({ issues: [evIssue], timeline: pr('2026-11-01T00:00:00Z'), annotations: [{ title: 'pi', message: 'ok' }] })
  await runMain(io)
  assert.equal(io.calls.length, 7)
  const comment = io.calls.find(c => c.startsWith('issue comment'))
  assert.ok(comment.includes('## ✅ Seen working') && comment.includes('http://run'))
  assert.ok(io.calls.at(-1).startsWith('issue close') && io.calls.at(-1).includes('--reason completed'))
})

test('main does not close when the needle is absent', async () => {
  const io = fakeIo({ issues: [evIssue], timeline: pr('2026-11-01T00:00:00Z'), annotations: [{ title: 'a', message: 'b' }] })
  await runMain(io)
  assert.equal(io.calls.length, 5)
  assert.ok(!io.calls.some(c => c.startsWith('issue ')))
})
