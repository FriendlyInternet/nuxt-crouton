import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publish } from './publish.mjs'

const fake = ({ status = ' M metrics/x', failPushes = 0 } = {}) => {
  const log = []
  let fails = failPushes
  const run = (args) => {
    log.push(args.filter(a => !a.startsWith('user.') && a !== '-c').join(' '))
    if (args[0] === 'status') return status
    if (args[0] === 'push' && fails-- > 0) throw new Error('non-fast-forward')
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
  assert.throws(() => publish({ dir: '/nonexistent', message: 'm', run: fake({ failPushes: 9 }).run, tries: 2 }), /non-fast-forward/)
})
