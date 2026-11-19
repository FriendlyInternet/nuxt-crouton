// #3691 — the owner's note travels in the 📐 save comment. The note lives in the COMMENT (not only in
// .resume-answer.md) because the comment body is the one thing every resume path reads: the revise
// worker and the planner fetch exactly this body into feedback.txt (work-issue-pidev.yml), the
// decomposer reads the thread, and the generic resume quotes it. Node 22 strips the .ts types.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../workers/ticket-editor/src/index.ts'
import { addedSceneText, saveCommentBody, SAVE_FIRST_LINE } from '../workers/ticket-editor/src/note.ts'
import { signEditorToken, deriveEditorSecret } from '../pocs/status/server/utils/editor-token-core.ts'
import { isOwnerScreenSource, parseDiagramSave, ownerScreenEmoji } from './lib/owner-screens.mjs'
import { routeComment } from './comment-route.mjs'
import { shouldRevise } from './revise-route.mjs'

const T = (text, extra = {}) => ({ type: 'text', text, ...extra })

test('addedSceneText: only text that is new, live and non-empty', () => {
  assert.deepEqual(addedSceneText({ elements: [T('A')] }, { elements: [T('A'), T('move login left')] }), ['move login left'])
  assert.deepEqual(addedSceneText({ elements: [T('A')] }, { elements: [T('A'), T('gone', { isDeleted: true }), T('  '), { type: 'rectangle' }] }), [])
  assert.deepEqual(addedSceneText(null, { elements: [T('A'), T(' B ')] }), ['A', 'B'])
  assert.deepEqual(addedSceneText({}, undefined), [])
})

test('SAVE_FIRST_LINE: the owner-screen helper reads it as a 📐 diagram save', () => {
  assert.equal(ownerScreenEmoji(SAVE_FIRST_LINE), '📐')
  assert.equal(ownerScreenEmoji('> ' + SAVE_FIRST_LINE), null)
})

const BASE = { slug: 'flow', branch: 'work-12', sha: 'abcdef1234', path: 'writeups/diagrams/flow.excalidraw', img: 'https://img', editUrl: 'https://e', at: '2026-11-11T00:00:00Z' }

test('saveCommentBody: fixed first line, hidden line round-trips, note quoted, no "nothing continues"', () => {
  const body = saveCommentBody({ ...BASE, note: ['move login left'] })
  assert.equal(body.split('\n')[0], '📐 Diagram saved — continuing from your edit')
  assert.deepEqual(parseDiagramSave(body), { slug: 'flow', branch: 'work-12', sha: 'abcdef1234', path: 'writeups/diagrams/flow.excalidraw' })
  assert.match(body, /\n> move login left\n/)
  assert.doesNotMatch(body, /nothing continues automatically/)
  assert.match(body, /@ `abcdef1`/)
})

test('saveCommentBody: a note starting with 📐 stays quoted; empty and unknown notes say so', () => {
  const body = saveCommentBody({ ...BASE, note: ['📐 sneaky\nsecond line'] })
  assert.match(body, /\n> 📐 sneaky\n> second line\n/)
  assert.equal(body.split('\n')[0], '📐 Diagram saved — continuing from your edit')
  assert.match(saveCommentBody({ ...BASE, note: [] }), /_no new text in the drawing_/)
  assert.match(saveCommentBody({ ...BASE }), /_could not compare with the previous version_/)
  const long = saveCommentBody({ ...BASE, note: ['x'.repeat(900), ...Array.from({ length: 30 }, (_, i) => 'l' + i)] })
  assert.ok(long.split('\n').filter(l => l.startsWith('> ')).length <= 21)
  assert.ok(!long.includes('x'.repeat(501)))
})

// ── end to end through worker.fetch ───────────────────────────────────────────────────────────────
const SECRET = await deriveEditorSecret('seed')
const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const PEM = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----'
const ENV = { REPO: 'o/r', OWNER_TOKEN_SECRET: SECRET, GITHUB_APP_ID: '1', GITHUB_APP_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: PEM, DIAGRAMS_DIR: 'writeups/diagrams' }
const SCENE_PATH = 'writeups/diagrams/x.excalidraw'

/** Saves `scene`; `prev` is the `.excalidraw` GET result (undefined → 404). Returns the posted comment body. */
async function saveAndGetComment(scene, prev) {
  let posted = null
  const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s })
  const orig = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET'
    if (url.endsWith('/access_tokens')) return j({ token: 'inst' }, 201)
    if (url === 'https://api.github.com/repos/o/r') return j({ default_branch: 'main' })
    if (/\/branches\/diagram-test$/.test(url)) return j({ protected: false })
    if (/\/issues\/5$/.test(url)) return j({})
    if (method === 'GET' && url.includes('/contents/' + SCENE_PATH)) return prev === undefined ? j({}, 404) : j(prev)
    if (method === 'PUT') return j({ commit: { sha: url.includes('.png') ? 'pngsha1234' : 'scenesha12', parents: [{ sha: 'p' }] } })
    if (method === 'POST' && url.endsWith('/issues/5/comments')) { posted = JSON.parse(init.body).body; return j({}) }
    return j({}, 404)
  }
  try {
    const tok = await signEditorToken(SECRET, Date.now())
    const res = await worker.fetch(new Request('https://d/api/save', { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify({ slug: 'x', branch: 'diagram-test', issue: 5, scene, png: 'AAAA' }) }), ENV)
    assert.equal(res.status, 200)
  } finally { globalThis.fetch = orig }
  assert.ok(posted, 'a comment was posted')
  return posted
}

const b64 = (o) => Buffer.from(JSON.stringify(o, null, 2)).toString('base64').replace(/(.{60})/g, '$1\n')
const NEW_SCENE = { elements: [T('A'), T('move login left')] }

test('the owner\'s note travels in the save comment: old scene A, new scene A + note', async () => {
  const body = await saveAndGetComment(NEW_SCENE, { sha: 'old', content: b64({ elements: [T('A')] }) })
  assert.match(body, /\n> move login left\n/)
  assert.doesNotMatch(body, /\n> A\n/)
  assert.equal(parseDiagramSave(body).sha, 'pngsha1234')
})

test('the owner\'s note travels in the save comment: a new file lists every text; empty content says could not compare', async () => {
  const fresh = await saveAndGetComment(NEW_SCENE, undefined)
  assert.match(fresh, /\n> A\n> move login left\n/)
  const big = await saveAndGetComment(NEW_SCENE, { sha: 'old', content: '' })
  assert.match(big, /could not compare/)
})

test('the owner\'s note travels in the save comment: every resume path sees those same bytes', async () => {
  const body = await saveAndGetComment(NEW_SCENE, { sha: 'old', content: b64({ elements: [T('A')] }) })
  const comment = { body, authorAssociation: 'NONE', userType: 'Bot', performedViaGithubApp: 'Nuxt Harness', appSlug: 'nuxt-harness', userLogin: 'nuxt-harness[bot]' }
  // generic resume + design-hold (thread) + payload: the source check
  assert.equal(isOwnerScreenSource({ comment }), true)
  // the router wakes the resume on a blocked pipeline issue
  const held = { number: 5, isPr: false, labels: ['status:blocked', 'work-this'], body: '<!-- pipeline: base=main -->' }
  assert.equal(routeComment({ comment, issue: held }).kind, 'resume')
  // the PR revise path (the worker reads this body as feedback.txt)
  assert.equal(shouldRevise({ ...comment, labels: ['status:blocked'] }).revise, true)
  assert.match(body, /move login left/)
})
