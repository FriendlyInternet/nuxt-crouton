// diagram-branch.test.mjs — saveDiagramScene commits the scene to `diagrams` (#3690).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveDiagramScene } from './diagram-branch.mjs'

const R = 'o/r'
const SCENE = '{"type":"excalidraw","elements":[]}\n'
const httpErr = (code, msg) => Object.assign(new Error(`gh: ${msg} (HTTP ${code})`), { stderr: `gh: ${msg} (HTTP ${code})` })

// A mock `gh` that answers by URL. `opts` decides which calls fail.
function setup(opts = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'diagram-branch-'))
  const file = join(tmpDir, 's.excalidraw')
  writeFileSync(file, SCENE)
  const calls = []
  const puts = []
  let putCount = 0
  const exec = (bin, args) => {
    calls.push([bin, ...args])
    const url = args.find(a => String(a).startsWith('repos/'))
    if (url === `repos/${R}/git/ref/heads/diagrams`) {
      if (opts.refErr) throw opts.refErr
      if (!opts.branchExists) throw httpErr(404, 'Not Found')
      return 'branchsha'
    }
    if (url === `repos/${R}`) return 'main'
    if (url === `repos/${R}/git/ref/heads/main`) return 'mainsha'
    if (url === `repos/${R}/git/refs`) { if (opts.createErr) throw opts.createErr; return '' }
    if (url.startsWith(`repos/${R}/contents/`) && !args.includes('PUT')) {
      if (!opts.fileExists) throw httpErr(404, 'Not Found')
      return `filesha${putCount}`
    }
    if (args.includes('PUT')) {
      putCount++
      puts.push(JSON.parse(readFileSync(args[args.indexOf('--input') + 1], 'utf8')))
      if (opts.putFails && putCount <= opts.putFails) throw httpErr(409, 'Conflict')
      return ''
    }
    throw new Error(`unexpected call ${args.join(' ')}`)
  }
  return { tmpDir, file, calls, puts, exec }
}
const save = (s, extra = {}) => saveDiagramScene({ exec: s.exec, repo: R, slug: 's', file: s.file, issue: 7, tmpDir: s.tmpDir, ...extra })
const urls = s => s.calls.map(c => c.slice(1).filter(a => !String(a).startsWith('-') && a !== 'POST' && a !== 'PUT').find(a => String(a).startsWith('repos/')))
const noForce = s => assert.ok(!s.calls.some(c => c.includes('--force') || c.some(a => String(a).includes('force=true')) || (c.includes('PATCH') && c.some(a => String(a).includes('git/refs')))), 'no force-push')

test('branch missing → created from the default branch, then the scene PUT (new file, no sha)', () => {
  const s = setup()
  assert.deepEqual(save(s), { branch: 'diagrams', path: 'writeups/diagrams/s.excalidraw' })
  assert.deepEqual(urls(s), [
    `repos/${R}/git/ref/heads/diagrams`, `repos/${R}`, `repos/${R}/git/ref/heads/main`, `repos/${R}/git/refs`,
    `repos/${R}/contents/writeups/diagrams/s.excalidraw?ref=diagrams`, `repos/${R}/contents/writeups/diagrams/s.excalidraw`,
  ])
  const post = s.calls.find(c => c.includes(`repos/${R}/git/refs`))
  assert.ok(post.includes('ref=refs/heads/diagrams') && post.includes('sha=mainsha'))
  assert.equal(s.puts.length, 1)
  assert.equal(s.puts[0].branch, 'diagrams')
  assert.equal(s.puts[0].sha, undefined)
  assert.equal(Buffer.from(s.puts[0].content, 'base64').toString('utf8'), SCENE)
  noForce(s)
})

test('branch and file exist → no ref create, PUT overwrites with the current sha', () => {
  const s = setup({ branchExists: true, fileExists: true })
  save(s)
  assert.ok(!s.calls.some(c => c.includes(`repos/${R}/git/refs`)))
  assert.equal(s.puts[0].sha, 'filesha0')
  noForce(s)
})

test('branch exists, file missing → PUT has no sha', () => {
  const s = setup({ branchExists: true })
  save(s)
  assert.equal(s.puts.length, 1)
  assert.equal(s.puts[0].sha, undefined)
  noForce(s)
})

test('refuses main and a bad slug before calling anything', () => {
  const s = setup()
  assert.throws(() => save(s, { branch: 'main' }), /refusing/)
  assert.throws(() => save(s, { branch: '' }), /refusing/)
  assert.throws(() => save(s, { slug: '../x' }), /bad diagram slug/)
  assert.equal(s.calls.length, 0)
})

test('create race: 422 "Reference already exists" still writes the scene', () => {
  const s = setup({ createErr: httpErr(422, 'Reference already exists') })
  save(s)
  assert.equal(s.puts.length, 1)
})

test('a non-404 ref error rethrows and creates/writes nothing', () => {
  const s = setup({ refErr: httpErr(500, 'Server Error') })
  assert.throws(() => save(s), /500/)
  assert.ok(!s.calls.some(c => c.includes(`repos/${R}/git/refs`)))
  assert.equal(s.puts.length, 0)
})

test('409 on PUT → re-read the sha once and retry once', () => {
  const s = setup({ branchExists: true, fileExists: true, putFails: 1 })
  save(s)
  assert.equal(s.puts.length, 2)
  assert.equal(s.puts[1].sha, 'filesha1')
  // a second 409 is not retried forever
  const s2 = setup({ branchExists: true, fileExists: true, putFails: 5 })
  assert.throws(() => save(s2), /409/)
  assert.equal(s2.puts.length, 2)
})
