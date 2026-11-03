// Tests for the ticket-editor owner-only save guards (#3261). Node 22 strips the .ts types.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../workers/ticket-editor/src/index.ts'
import { MAX_TOKEN_LIFETIME_S, TOKEN_AUD, branchAllowed, issueAllowed, verifyOwnerToken } from '../workers/ticket-editor/src/guard.ts'
import { deriveEditorSecret, safeEditorReturn, signEditorToken } from '../pocs/status/server/utils/editor-token-core.ts'

const REPO = 'o/r'
const SECRET = await deriveEditorSecret('seed')
const now = Date.now()


/** Stub fetch: records calls; `branches` maps branch → protected flag. */
function stub({ branchStatus = 200, issues = { 5: {} }, branches = { 'diagram-test': false } } = {}) {
  const calls = []
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method })
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s })
    let m
    if (url === 'https://api.github.com/repos/o/r') return j({ default_branch: 'main' })
    if ((m = url.match(/\/repos\/o\/r\/branches\/(.+)$/))) {
      if (branchStatus !== 200) return j({}, branchStatus)
      const b = decodeURIComponent(m[1])
      return b in branches ? j({ protected: branches[b] }) : j({}, 404)
    }
    if ((m = url.match(/\/repos\/o\/r\/issues\/(\d+)$/))) return m[1] in issues ? j(issues[m[1]]) : j({}, 404)
    if (method === 'PUT') return j({ commit: { sha: 'abc', parents: [{ sha: 'p' }] } })
    if (method === 'POST') return j({})
    return j({}, 404)
  }
  return { impl, calls }
}

test('verifyOwnerToken: valid, bad signature, expired, wrong aud, long lifetime, empty secret', async () => {
  const good = await signEditorToken(SECRET, now)
  assert.equal(await verifyOwnerToken(good, SECRET, now), true)
  assert.equal(await verifyOwnerToken(good, SECRET + 'x', now), false)
  assert.equal(await verifyOwnerToken(good, '', now), false)
  assert.equal(await verifyOwnerToken(good, SECRET, now + 11 * 60 * 1000), false) // expired
  assert.equal(await verifyOwnerToken(good.slice(0, -2) + 'AA', SECRET, now), false)
  assert.equal(await verifyOwnerToken('', SECRET, now), false)
  // a token whose exp is far in the future is refused even if correctly signed
  const far = await signEditorToken(SECRET, now + 3600 * 1000)
  assert.equal(await verifyOwnerToken(far, SECRET, now), false)
  // wrong aud, correctly signed
  const payload = Buffer.from(JSON.stringify({ aud: 'other', exp: Math.floor(now / 1000) + 60 })).toString('base64url')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url')
  assert.equal(await verifyOwnerToken(`${payload}.${sig}`, SECRET, now), false)
})

test('save without Authorization → 401 and zero GitHub calls', async () => {
  const s = stub()
  const orig = globalThis.fetch
  globalThis.fetch = s.impl
  try {
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const res = await worker.fetch(new Request('https://d/api/save', { method: 'POST', headers, body: JSON.stringify({ slug: 'x', branch: 'diagram-test', scene: {} }) }), { REPO, OWNER_TOKEN_SECRET: SECRET })
      assert.equal(res.status, 401)
    }
    assert.equal(s.calls.length, 0)
  } finally { globalThis.fetch = orig }
})

test('branchAllowed: default refused, protected refused, plain work branch ok, lookup 500 fails closed', async () => {
  assert.equal(await branchAllowed(stub().impl, 't', REPO, 'main'), false)
  assert.equal(await branchAllowed(stub({ branches: { rel: true } }).impl, 't', REPO, 'rel'), false)
  assert.equal(await branchAllowed(stub().impl, 't', REPO, 'diagram-test'), true)
  assert.equal(await branchAllowed(stub({ branchStatus: 500 }).impl, 't', REPO, 'diagram-test'), false)
  assert.equal(await branchAllowed(stub().impl, 't', REPO, 'bad branch?'), false)
})

test('issueAllowed: real issue ok, PR / 404 / junk refused', async () => {
  const s = stub({ issues: { 5: {}, 6: { pull_request: {} } } })
  assert.equal(await issueAllowed(s.impl, 't', REPO, 5), true)
  assert.equal(await issueAllowed(s.impl, 't', REPO, 6), false)
  assert.equal(await issueAllowed(s.impl, 't', REPO, 7), false)
  assert.equal(await issueAllowed(s.impl, 't', REPO, NaN), false)
})

test('safeEditorReturn: only the exact editor origin', () => {
  assert.ok(safeEditorReturn('https://diagram.pmcp.dev/?slug=a&branch=b'))
  assert.equal(safeEditorReturn('https://evil.example/'), null)
  assert.equal(safeEditorReturn('https://diagram.pmcp.dev.evil.example/'), null)
  assert.equal(safeEditorReturn('//x'), null)
  assert.equal(safeEditorReturn(undefined), null)
})

test('token constants match what the status app signs', async () => {
  assert.equal(TOKEN_AUD, 'ticket-editor')
  const tok = await signEditorToken(SECRET, Date.now())
  const payload = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString())
  assert.equal(payload.aud, TOKEN_AUD)
  assert.ok(payload.exp - Math.floor(Date.now() / 1000) <= MAX_TOKEN_LIFETIME_S)
})
