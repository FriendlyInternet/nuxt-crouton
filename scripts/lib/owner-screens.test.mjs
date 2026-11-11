import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OWNER_SCREENS, OWNER_SCREEN_APPS, ownerScreenEmoji, isOwnerScreenSource, isOwnerScreenComment,
  parseDiagramSave, diagramSaveLine,
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
