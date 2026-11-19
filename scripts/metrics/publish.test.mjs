import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publish } from './publish.mjs'

// failPushes: refuse the first N pushes with "non-fast-forward".
// failMessages: refuse one push per message, in order (overrides failPushes).
// failRebase: the first `pull --rebase` throws.
const fake = ({ status = ' M metrics/x', failPushes = 0, failMessages = null, failRebase = false } = {}) => {
  const log = []
  const refusals = failMessages ? [...failMessages] : Array.from({ length: failPushes }, () => 'non-fast-forward')
  const run = (args) => {
    log.push(args.filter(a => !a.startsWith('user.') && a !== '-c').join(' '))
    if (args[0] === 'status') return status
    if (args[0] === 'push' && refusals.length) throw new Error(refusals.shift())
    if (args.includes('pull') && failRebase) throw new Error('CONFLICT rebase')
    return args[0] === 'rev-parse' ? 'abc123\n' : ''
  }
  return { run, log }
}

test('no change → nothing committed or pushed', () => {
  const f = fake({ status: '' })
  assert.deepEqual(publish({ dir: '/nonexistent', message: 'm', run: f.run }), { pushed: false, sha: null })
  assert.ok(!f.log.some(l => l.startsWith('push') || l.startsWith('commit')))
})

test('non-fast-forward → rebase then push again', () => {
  const f = fake({ failPushes: 2 })
  assert.deepEqual(publish({ dir: '/nonexistent', message: 'm', run: f.run }), { pushed: true, sha: 'abc123' })
  assert.equal(f.log.filter(l => l.startsWith('pull --rebase')).length, 2)
})

test('gives up after the last try', () => {
  assert.throws(
    () => publish({ dir: '/nonexistent', message: 'm', run: fake({ failPushes: 9 }).run, tries: 2 }),
    (e) => /refused 2 times/.test(e.message) && /non-fast-forward/.test(e.message),
  )
})

// covers: T1
test('refused 4 times (one "cannot lock ref") → accepted on the 5th, 4 rebases', () => {
  const f = fake({
    failMessages: [
      'non-fast-forward',
      'non-fast-forward',
      "cannot lock ref 'refs/heads/pipeline-data': is at 1d926c9d but expected 9b9644e8",
      'non-fast-forward',
    ],
  })
  assert.deepEqual(publish({ dir: '/nonexistent', message: 'm', run: f.run }), { pushed: true, sha: 'abc123' })
  assert.equal(f.log.filter(l => l.startsWith('pull --rebase')).length, 4)
})

// covers: T2
test('refused 6 times → our own error naming the count and pipeline-data, 6 pushes tried', () => {
  const f = fake({ failPushes: 6 })
  assert.throws(
    () => publish({ dir: '/nonexistent', message: 'm', run: f.run }),
    (e) => /6/.test(e.message) && /pipeline-data/.test(e.message) && e.cause instanceof Error,
  )
  assert.equal(f.log.filter(l => l.startsWith('push')).length, 6)
})

// covers: T3
test('a failing rebase stops at once — push not tried again', () => {
  const f = fake({ failPushes: 1, failRebase: true })
  assert.throws(() => publish({ dir: '/nonexistent', message: 'm', run: f.run }), /CONFLICT rebase/)
  assert.equal(f.log.filter(l => l.startsWith('push')).length, 1)
  assert.equal(f.log.filter(l => l.startsWith('pull --rebase')).length, 1)
})

// covers: T4
test('no waiting between tries — publish.mjs has no timers', () => {
  const src = readFileSync(new URL('./publish.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /setTimeout|sleep|Atomics\.wait/)
})
