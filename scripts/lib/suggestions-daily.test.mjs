// The daily suggestions list (#4308, epic #4223 step 1) — How to test cases 1–9.
//   node --test scripts/lib/suggestions-daily.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGroupPrompt, parseGroups, rankIdeas, renderComment, decidePost, cleanTitle } from './suggestions-daily.mjs'

const NOW = new Date('2026-11-20T12:00:00.000Z')
const DATE = '2026-11-20'
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
let seq = 0
const line = (over = {}) => {
  const ts = over.ts ?? daysAgo(1)
  seq += 1
  return {
    id: `suggestions/${ts.slice(0, 10)}/${ts.replace(/[:.]/g, '-')}-r${seq}.json`,
    ts,
    source: 'worker run 1',
    area: 'pipeline',
    text: `Idea ${seq}`,
    evidence: `https://github.com/FriendlyInternet/nuxt-crouton/issues/${4000 + seq}`,
    ...over,
  }
}
const bot = (body, createdAt = '2026-11-19T07:00:00Z') => ({ author: { login: 'github-actions[bot]' }, body, createdAt })
const numbered = (body) => body.split('\n').filter((l) => /^\d+\. /.test(l))

// covers: T1
test('1: two lines in one group → one idea with count 2', () => {
  const a = line(); const b = line()
  const { groups } = parseGroups(JSON.stringify([{ title: 'Same idea', ids: [a.id, b.id] }]), [a, b])
  const top = rankIdeas([a, b], groups, NOW)
  assert.equal(top.length, 1)
  assert.equal(top[0].count, 2)
  assert.equal(top[0].title, 'Same idea')
})

// covers: T1
test('2: five groups → three, highest counts first; a tie goes to the newer line', () => {
  const g = (n, age) => Array.from({ length: n }, () => line({ ts: daysAgo(age) }))
  const big = g(4, 3); const mid = g(2, 3); const tieOld = g(1, 5); const tieNew = g(1, 1); const tieMid = g(1, 4)
  const all = [...big, ...mid, ...tieOld, ...tieNew, ...tieMid]
  const groups = [tieOld, big, tieNew, mid, tieMid].map((ls, i) => ({ title: `g${i}`, ids: ls.map((l) => l.id) }))
  const top = rankIdeas(all, groups, NOW)
  assert.equal(top.length, 3)
  assert.deepEqual(top.map((t) => t.count), [4, 2, 1])
  assert.equal(top[2].lines[0].id, tieNew[0].id)
})

// covers: T1
test('3: a lone 31-day-old line is not listed; with a second line 7 days old it is, count 2', () => {
  const old = line({ ts: daysAgo(31) })
  assert.deepEqual(rankIdeas([old], [{ title: 'x', ids: [old.id] }], NOW), [])
  const recent = line({ ts: daysAgo(7) })
  const top = rankIdeas([old, recent], [{ title: 'x', ids: [old.id, recent.id] }], NOW)
  assert.equal(top.length, 1)
  assert.equal(top[0].count, 2)
})

// covers: T1
test('4: every line expired → empty list', () => {
  const ls = [line({ ts: daysAgo(40) }), line({ ts: daysAgo(35) })]
  const { groups } = parseGroups('[]', ls)
  assert.deepEqual(rankIdeas(ls, groups, NOW), [])
})

// covers: T1
test('5: parseGroups — broken JSON, an id in two groups, a line left out', () => {
  const a = line(); const b = line(); const c = line()
  const broken = parseGroups('{not json', [a, b, c])
  assert.ok(broken.error)
  assert.deepEqual(broken.groups.map((g) => g.ids), [[a.id], [b.id], [c.id]])

  const dup = parseGroups(JSON.stringify([{ title: 'one', ids: [a.id, b.id] }, { title: 'two', ids: [b.id, 'nope'] }, { title: 'three', ids: [c.id] }]), [a, b, c])
  assert.equal(dup.error, null)
  assert.deepEqual(dup.groups.map((g) => g.ids), [[a.id, b.id], [c.id]])

  const missing = parseGroups(JSON.stringify([{ title: 'one', ids: [a.id] }]), [a, b])
  assert.deepEqual(missing.groups.map((g) => g.ids), [[a.id], [b.id]])
})

// covers: T1
test('6: renderComment — marker with sorted ids, three numbered lines, evidence links, not-grouped note, no pings, 120 cut', () => {
  const ls = [line(), line(), line(), line()]
  const top = [
    { title: 'First', count: 2, lines: [ls[3], ls[0]] },
    { title: 'Ask @someone first', count: 1, lines: [ls[1]] },
    { title: 'x'.repeat(300), count: 1, lines: [ls[2]] },
  ]
  const body = renderComment(top, { date: DATE, grouped: true })
  const first = body.split('\n')[0]
  assert.equal(first, `<!-- suggestions-daily:v1 date=${DATE} ids=${ls.map((l) => l.id).sort().join(',')} -->`)
  assert.equal(numbered(body).length, 3)
  for (const l of ls) {
    assert.ok(body.includes(`(${l.evidence})`), `missing evidence ${l.evidence}`)
    assert.ok(body.includes(`blob/pipeline-data/${l.id}`), `missing line link ${l.id}`)
  }
  assert.match(body, /seen 2× — pipeline/)
  assert.ok(body.includes('`@someone`'))
  assert.doesNotMatch(body.replace(/`@someone`/g, ''), /@someone/)
  assert.doesNotMatch(body, /not grouped/)
  const long = numbered(body)[2].match(/^3\. (x+…) — /)[1]
  assert.equal(long.length, 120)
  assert.equal(cleanTitle('a\nb'), 'a b')

  assert.match(renderComment(top, { date: DATE, grouped: false }), /not grouped/)
})

// covers: T1
test('7: decidePost — clear, skip-duplicate, skip-unchanged, post; five in → three shown', () => {
  const ls = [line(), line(), line(), line(), line()]
  const five = ls.map((l, i) => ({ title: `t${i}`, count: 1, lines: [l] }))
  const top = rankIdeas(ls, five.map((t) => ({ title: t.title, ids: [t.lines[0].id] })), NOW)
  assert.equal(top.length, 3)
  assert.equal(decidePost({ top: [], comments: [], date: DATE }), 'clear')
  assert.equal(decidePost({ top, comments: [bot(renderComment(top, { date: DATE }))], date: DATE }), 'skip-duplicate')
  assert.equal(decidePost({ top, comments: [bot(renderComment(top, { date: '2026-11-19' }))], date: DATE }), 'skip-unchanged')
  assert.equal(decidePost({ top, comments: [], date: DATE }), 'post')
  // a marker from anyone other than the post job's account does not count
  const human = { author: { login: 'pmcp' }, body: renderComment(top, { date: DATE }) }
  assert.equal(decidePost({ top, comments: [human], date: DATE }), 'post')
  // only the NEWEST marker decides "unchanged"
  const older = bot(renderComment(top, { date: '2026-11-18' }), '2026-11-18T07:00:00Z')
  const newer = bot(renderComment(top.slice(0, 1), { date: '2026-11-19' }), '2026-11-19T07:00:00Z')
  assert.equal(decidePost({ top, comments: [newer, older], date: DATE }), 'post')
  assert.equal(numbered(renderComment(five, { date: DATE })).length, 3)
})

// covers: T1
test('8: empty log — no groups, no error, nothing ranked, clear', () => {
  for (const text of ['', undefined, 'garbage']) {
    const { groups, error } = parseGroups(text, [])
    assert.deepEqual(groups, [])
    assert.equal(error, null)
    const top = rankIdeas([], groups, NOW)
    assert.deepEqual(top, [])
    assert.equal(decidePost({ top, comments: [], date: DATE }), 'clear')
  }
})

// covers: T1
test('9: buildGroupPrompt names the output file and lists each line as id · area · text', () => {
  const ls = [line({ area: 'docs', text: 'Fix the docs' }), line({ area: 'tests', text: 'More tests' })]
  const p = buildGroupPrompt(ls, '/o/groups.json')
  assert.ok(p.includes('/o/groups.json'))
  for (const l of ls) assert.ok(p.includes(`${l.id} · ${l.area} · ${l.text}`))
})
