// Tests for the ticket-editor owner-only save guards (#3261). Node 22 strips the .ts types.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../workers/ticket-editor/src/index.ts'
import { MAX_TOKEN_LIFETIME_S, TOKEN_AUD, branchAllowed, issueAllowed, verifyOwnerToken } from '../workers/ticket-editor/src/guard.ts'
import { deriveEditorSecret, safeEditorReturn, signEditorToken } from '../pocs/status/server/utils/editor-token-core.ts'

const REPO = 'o/r'
const SECRET = await deriveEditorSecret('seed')
const now = Date.now()


/** Stub fetch: records calls; `branches` maps branch → protected flag; `files` maps a contents path → its GET JSON (#3691). */
function stub({ branchStatus = 200, issues = { 5: {} }, branches = { 'diagram-test': false }, files = {} } = {}) {
  const calls = []
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body })
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s })
    let m
    if (url === 'https://api.github.com/repos/o/r') return j({ default_branch: 'main' })
    if ((m = url.match(/\/repos\/o\/r\/branches\/(.+)$/))) {
      if (branchStatus !== 200) return j({}, branchStatus)
      const b = decodeURIComponent(m[1])
      return b in branches ? j({ protected: branches[b] }) : j({}, 404)
    }
    if ((m = url.match(/\/repos\/o\/r\/issues\/(\d+)$/))) return m[1] in issues ? j(issues[m[1]]) : j({}, 404)
    if (method === 'GET' && (m = url.match(/\/contents\/([^?]+)/)) && m[1] in files) return j(files[m[1]])
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
  const [body, sigB64] = good.split('.')
  const tampered = `${body}.${sigB64[0] === 'A' ? 'B' : 'A'}${sigB64.slice(1)}`
  assert.equal(await verifyOwnerToken(tampered, SECRET, now), false)
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

// ── save() end to end, through worker.fetch (#3261 review) ──────────────────────────────────────
const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const PEM = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----'
const ENV = { REPO, OWNER_TOKEN_SECRET: SECRET, GITHUB_APP_ID: '1', GITHUB_APP_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: PEM, DIAGRAMS_DIR: 'writeups/diagrams' }

async function ownerSave(body, s = stub()) {
  const impl = async (url, init = {}) => {
    if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'inst' }), { status: 201 })
    return s.impl(url, init)
  }
  const orig = globalThis.fetch
  globalThis.fetch = impl
  try {
    const tok = await signEditorToken(SECRET, Date.now())
    const res = await worker.fetch(new Request('https://d/api/save', { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify({ slug: 'x', scene: {}, png: 'AAAA', ...body }) }), ENV)
    return { res, calls: s.calls }
  } finally { globalThis.fetch = orig }
}
const puts = (calls) => calls.filter((c) => c.method === 'PUT')

test('save as owner to a work branch → both files committed (2 PUTs)', async () => {
  const { res, calls } = await ownerSave({ branch: 'diagram-test' })
  assert.equal(res.status, 200)
  assert.equal(puts(calls).length, 2)
})

test('save as owner to main → 403 and no PUT', async () => {
  const { res, calls } = await ownerSave({ branch: 'main' })
  assert.equal(res.status, 403)
  assert.equal(puts(calls).length, 0)
})

test('save as owner to a protected branch → 403 and no PUT', async () => {
  const { res, calls } = await ownerSave({ branch: 'rel' }, stub({ branches: { rel: true } }))
  assert.equal(res.status, 403)
  assert.equal(puts(calls).length, 0)
})

test('save when the branch lookup errors → 403 and no PUT (fails closed)', async () => {
  const { res, calls } = await ownerSave({ branch: 'diagram-test' }, stub({ branchStatus: 500 }))
  assert.equal(res.status, 403)
  assert.equal(puts(calls).length, 0)
})

test('save with a pull-request number as issue → 403, no PUT, no comment', async () => {
  const { res, calls } = await ownerSave({ branch: 'diagram-test', issue: 6 }, stub({ issues: { 6: { pull_request: {} } } }))
  assert.equal(res.status, 403)
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0)
})

test('save with a real issue → files committed and a comment posted', async () => {
  const { res, calls } = await ownerSave({ branch: 'diagram-test', issue: 5 })
  assert.equal(res.status, 200)
  assert.equal(puts(calls).length, 2)
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/5/comments')))
})

test('save over an existing scene → the posted comment opens with 📐 and quotes only the added text (#3691)', async () => {
  const prev = Buffer.from(JSON.stringify({ elements: [{ type: 'text', text: 'A' }] })).toString('base64')
  const s = stub({ files: { 'writeups/diagrams/x.excalidraw': { sha: 'old', content: prev } } })
  const scene = { elements: [{ type: 'text', text: 'A' }, { type: 'text', text: 'move login left' }] }
  const { res, calls } = await ownerSave({ branch: 'diagram-test', issue: 5, scene }, s)
  assert.equal(res.status, 200)
  const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues/5/comments'))
  const body = JSON.parse(post.body).body
  assert.equal(body.split('\n')[0], '📐 Diagram saved — continuing from your edit')
  assert.match(body, /\n> move login left\n/)
  assert.doesNotMatch(body, /\n> A\n/)
})

// ── refused tokens / targets through the save endpoint: 401/403, never a GitHub write ──────────
async function saveWith(tok, body = {}, s = stub()) {
  const orig = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => (url.endsWith('/access_tokens') ? new Response(JSON.stringify({ token: 'inst' }), { status: 201 }) : s.impl(url, init))
  try {
    const res = await worker.fetch(new Request('https://d/api/save', { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify({ slug: 'x', scene: {}, png: 'AAAA', branch: 'diagram-test', ...body }) }), ENV)
    return { res, writes: s.calls.filter((c) => c.method !== 'GET') }
  } finally { globalThis.fetch = orig }
}

test('save with an expired token → 401, no write', async () => {
  const { res, writes } = await saveWith(await signEditorToken(SECRET, now - 11 * 60 * 1000))
  assert.equal(res.status, 401)
  assert.equal(writes.length, 0)
})

test('save with a wrong-audience (correctly signed) token → 401, no write', async () => {
  const payload = Buffer.from(JSON.stringify({ aud: 'other', exp: Math.floor(now / 1000) + 60 })).toString('base64url')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url')
  const { res, writes } = await saveWith(`${payload}.${sig}`)
  assert.equal(res.status, 401)
  assert.equal(writes.length, 0)
})

test('save with an overlong token → 401, no write', async () => {
  const good = await signEditorToken(SECRET, now)
  const { res, writes } = await saveWith(good + 'A'.repeat(2100))
  assert.equal(res.status, 401)
  assert.equal(writes.length, 0)
})

test('save with an issue that is not a real ticket (404 / junk) → 403, no write', async () => {
  for (const issue of [999, 'abc', '5; drop']) {
    const tok = await signEditorToken(SECRET, Date.now())
    const { res, writes } = await saveWith(tok, { issue })
    assert.equal(res.status, 403, 'issue ' + issue)
    assert.equal(writes.length, 0)
  }
})
