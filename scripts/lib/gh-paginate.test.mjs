import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextLink, fetchAllPages } from './gh-paginate.mjs'
import { okButConflicting } from './stuck-prs.mjs'

const NOW = Date.parse('2026-11-07T12:00:00Z')
const ago = (d) => new Date(NOW - d * 86400000).toISOString()
const U = 'https://api.github.com/x?per_page=100'

// Serve `all` at 100 per page with GitHub-style Link headers.
const server = (all) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page') || 1)
  const data = all.slice((page - 1) * 100, page * 100)
  const last = Math.ceil(all.length / 100)
  const link = page < last ? `<${U}&page=${page + 1}>; rel="next", <${U}&page=${last}>; rel="last"` : `<${U}&page=1>; rel="first"`
  return { data, link }
}

const owner = (d, body) => ({ user: { login: 'pmcp', type: 'User' }, body, created_at: ago(d) })
const filler = (n) => Array.from({ length: n }, (_, i) => ({ user: { login: 'bot', type: 'Bot' }, body: `c${i}`, created_at: ago(10) }))
const pr = { number: 9, title: 't', html_url: 'u', mergeable_state: 'dirty' }
const base = { pr, commits: [], owner: 'pmcp', now: NOW }

test('nextLink parsing', () => {
  assert.equal(nextLink(`<${U}&page=2>; rel="next", <${U}&page=3>; rel="last"`), `${U}&page=2`)
  assert.equal(nextLink(`<${U}&page=1>; rel="prev", <${U}&page=3>; rel="last"`), null)
  assert.equal(nextLink(null), null)
  assert.equal(nextLink(''), null)
})

test('fetchAllPages concatenates in order', async () => {
  const all = filler(150)
  let calls = 0
  const f = server(all)
  const { items, truncated } = await fetchAllPages(async (u) => (calls++, f(u)), U)
  assert.equal(items.length, 150)
  assert.equal(items[149].body, 'c149')
  assert.equal(calls, 2)
  assert.equal(truncated, false)
})

test('okButConflicting: ok on page 2 is seen only when paginated', async () => {
  const all = filler(150)
  all[139] = owner(3, 'ok')
  const { items } = await fetchAllPages(server(all), U)
  assert.ok(okButConflicting({ ...base, comments: items }))
  assert.equal(okButConflicting({ ...base, comments: all.slice(0, 100) }), null)
})

test('okButConflicting: later not-ok on page 2 cancels an early ok', async () => {
  const all = filler(150)
  all[9] = owner(4, 'ok')
  all[139] = owner(3, 'not ok: rename it')
  const { items } = await fetchAllPages(server(all), U)
  assert.equal(okButConflicting({ ...base, comments: items }), null)
  assert.ok(okButConflicting({ ...base, comments: all.slice(0, 100) })) // the old, wrong answer
})

test('maxPages cap reports truncated only when data was left behind', async () => {
  const endless = async () => ({ data: [1], link: `<${U}&page=2>; rel="next"` })
  const r = await fetchAllPages(endless, U, { maxPages: 3 })
  assert.equal(r.items.length, 3)
  assert.equal(r.truncated, true)
  const exact = await fetchAllPages(server(filler(300)), U, { maxPages: 3 })
  assert.equal(exact.items.length, 300)
  assert.equal(exact.truncated, false)
})
