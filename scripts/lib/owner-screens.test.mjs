import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OWNER_SCREENS, OWNER_SCREEN_APPS, ownerScreenEmoji, isOwnerScreenSource, isOwnerScreenComment,
  parseDiagramSave, diagramSaveLine, linkedIssueNumber, sourceIssueFor, readDiagramScene,
} from './owner-screens.mjs'

const SAVE = '📐 Diagram saved — continuing from your edit\n<!-- owner-screen:diagram slug=flow branch=work-12 sha=abc123 path=writeups/diagrams/flow.excalidraw -->\n\nhi'
const harness = (body) => ({ body, appSlug: 'nuxt-harness', userType: 'Bot', userLogin: 'nuxt-harness[bot]' })
const blocked = { labels: ['status:blocked', 'work-this'] }

test('owner-screen helper: a 📐 save from nuxt-harness on a status:blocked issue counts', () => {
  assert.equal(isOwnerScreenComment({ comment: harness(SAVE), issue: blocked }), true)
})

test('owner-screen helper: a 🎯 comment on a blocked PR counts', () => {
  assert.equal(isOwnerScreenComment({ comment: harness('🎯 **Preview feedback**\n\n> move it'), issue: { labels: ['status:blocked'] } }), true)
})

test('owner-screen helper: the same on an unblocked item does not', () => {
  assert.equal(isOwnerScreenComment({ comment: harness(SAVE), issue: { labels: [] } }), false)
  assert.equal(isOwnerScreenSource({ comment: harness(SAVE) }), true)
})

test('owner-screen helper: a nuxt-harness comment without the emoji does not', () => {
  assert.equal(isOwnerScreenComment({ comment: harness('> 🤖 **pi.dev harness** · agent pipeline (CI)\n\n📐 x'), issue: blocked }), false)
  assert.equal(isOwnerScreenComment({ comment: harness('<!-- pipeline-note -->\n📐 x'), issue: blocked }), false)
})

test('owner-screen helper: a quote or a mid-line emoji does not', () => {
  assert.equal(isOwnerScreenComment({ comment: harness('> 📐 Diagram saved'), issue: blocked }), false)
  assert.equal(isOwnerScreenComment({ comment: harness('hi 📐'), issue: blocked }), false)
})

test('owner-screen helper: 📐 from another app does not', () => {
  for (const comment of [
    { body: SAVE, appSlug: 'github-actions', userLogin: 'github-actions[bot]' },
    { body: SAVE, appSlug: 'other' },
    { body: SAVE },
  ]) assert.equal(isOwnerScreenComment({ comment, issue: blocked }), false)
  // the login alone identifies the app when the slug is missing
  assert.equal(isOwnerScreenComment({ comment: { body: SAVE, userLogin: 'nuxt-harness[bot]' }, issue: blocked }), true)
})

test('owner-screen helper: 🚶 and 🗳 (with or without FE0F) are recognised', () => {
  assert.equal(ownerScreenEmoji('🚶 step 2 done'), '🚶')
  assert.equal(ownerScreenEmoji('🚶🏽 step'), '🚶')
  assert.equal(ownerScreenEmoji('🗳 1B'), '🗳')
  assert.equal(ownerScreenEmoji('🗳️ 1B'), '🗳')
  assert.equal(ownerScreenEmoji('\n\n🎯 x'), '🎯')
  assert.equal(ownerScreenEmoji('ok'), null)
  assert.deepEqual(OWNER_SCREENS.map(s => s.emoji), ['🎯', '📐', '🚶', '🗳'])
  assert.deepEqual(OWNER_SCREEN_APPS, ['nuxt-harness'])
})

test('owner-screen helper: parseDiagramSave round-trips the ticket-editor line', () => {
  assert.deepEqual(parseDiagramSave(SAVE), { slug: 'flow', branch: 'work-12', sha: 'abc123', path: 'writeups/diagrams/flow.excalidraw' })
  const d = { slug: 'a.b', branch: 'epic/9-x', sha: 'f00', path: 'writeups/diagrams/a.b.excalidraw' }
  assert.deepEqual(parseDiagramSave(diagramSaveLine(d)), d)
  assert.equal(parseDiagramSave('📐 nothing hidden'), null)
})

test('owner-screen helper: the --is-source CLI exits 0 only for a 📐 body from nuxt-harness', () => {
  const cli = fileURLToPath(new URL('./owner-screens.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'owner-screens-'))
  const save = join(dir, 'save.txt')
  const plain = join(dir, 'plain.txt')
  writeFileSync(save, SAVE)
  writeFileSync(plain, 'just a reply')
  const run = (...a) => spawnSync(process.execPath, [cli, '--is-source', ...a]).status
  assert.equal(run(save, 'nuxt-harness'), 0)
  assert.equal(run(save, 'github-actions'), 1)
  assert.equal(run(save, ''), 1)
  assert.equal(run(plain, 'nuxt-harness'), 1)
})

// #3691 review hole 1 — on a PR the hold label sits on the source issue, not the PR.
test('owner-screen helper: on a PR only the source issue\'s status:blocked counts', () => {
  const c = harness('🎯 **Preview feedback**')
  const prItem = { isPr: true, labels: [] }
  assert.equal(isOwnerScreenComment({ comment: c, issue: prItem, pr: { sourceIssue: { number: 3, labels: ['status:blocked'] } } }), true)
  assert.equal(isOwnerScreenComment({ comment: c, issue: prItem, pr: { sourceIssue: { number: 3, labels: [] } } }), false)
  assert.equal(isOwnerScreenComment({ comment: c, issue: { isPr: true, labels: ['status:blocked'] }, pr: { sourceIssue: null } }), false)
})

test('owner-screen helper: linkedIssueNumber reads `Closes #N` in prose only', () => {
  assert.equal(linkedIssueNumber('Closes #3691\n\nmore'), 3691)
  assert.equal(linkedIssueNumber('closes #12 and Closes #13'), 12)
  assert.equal(linkedIssueNumber('see `Closes #9`'), null)
  assert.equal(linkedIssueNumber('```\nCloses #9\n```'), null)
  assert.equal(linkedIssueNumber(''), null)
})

test('owner-screen helper: sourceIssueFor fetches the linked issue only for an owner-screen comment', async () => {
  const asked = []
  const getIssue = async (n) => { asked.push(n); return { labels: [{ name: 'status:blocked' }, 'x'] } }
  assert.deepEqual(await sourceIssueFor({ comment: harness('🎯 hi'), prBody: 'Closes #5', getIssue }), { number: 5, labels: ['status:blocked', 'x'] })
  assert.equal(await sourceIssueFor({ comment: harness('plain'), prBody: 'Closes #5', getIssue }), null)
  assert.equal(await sourceIssueFor({ comment: harness('🎯 hi'), prBody: 'no link', getIssue }), null)
  assert.deepEqual(asked, [5])
})

// #3691 review hole 2 — the resume job checks out ONE commit of main; the editor saved on another
// branch. A real git remote + a depth-1 clone of main, exactly like actions/checkout fetch-depth: 1.
// (GitHub serves any reachable sha on fetch; the local origin needs allowReachableSHA1InWant for that.)
test('owner-screen helper: readDiagramScene gets the scene for a sha that is not on main', () => {
  const root = mkdtempSync(join(tmpdir(), 'owner-screens-git-'))
  const origin = join(root, 'origin')
  const g = (cwd, ...a) => {
    const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  g(root, 'init', '-q', '-b', 'main', origin)
  g(origin, 'config', 'uploadpack.allowReachableSHA1InWant', 'true')
  writeFileSync(join(origin, 'README.md'), 'main\n')
  g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'main')
  g(origin, 'checkout', '-qb', 'work-12')
  const scene = '{"type":"excalidraw","elements":[{"text":"owner note"}]}\n'
  mkdirSync(join(origin, 'writeups/diagrams'), { recursive: true })
  writeFileSync(join(origin, 'writeups/diagrams/flow.excalidraw'), scene)
  g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'diagram')
  const sha = g(origin, 'rev-parse', 'HEAD')
  g(origin, 'checkout', '-q', 'main')

  const clone = join(root, 'clone')
  g(root, 'clone', '-q', '--depth=1', '--branch', 'main', `file://${origin}`, clone)
  assert.notEqual(spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: clone }).status, 0, 'precondition: the sha is not in the checkout')

  assert.equal(readDiagramScene({ sha, path: 'writeups/diagrams/flow.excalidraw' }, { cwd: clone }), scene)
  assert.equal(readDiagramScene({ sha, path: 'writeups/diagrams/missing.excalidraw' }, { cwd: clone }), null)
  assert.equal(readDiagramScene({ sha: '', path: 'x' }, { cwd: clone }), null)
  assert.equal(readDiagramScene({ sha: '--upload-pack=x', path: 'x' }, { cwd: clone }), null)
})
