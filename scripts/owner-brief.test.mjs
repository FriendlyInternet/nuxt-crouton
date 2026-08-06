/**
 * #2081 contract — the ping and the depth are different artifacts.
 *
 * The gate has exactly one job and one anti-job: constrain comments that NOTIFY the owner,
 * and leave every other comment completely alone. Both halves are load-bearing. A gate that
 * caught only the first would push agents to stop writing anything down; a gate that caught
 * the second would be refusing correct work.
 *
 *   node --test scripts/owner-brief.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkOwnerBrief, visiblePart, isAgentComment, explain,
  MAX_VISIBLE_CHARS, MAX_VISIBLE_LINES, BRIEF_TYPES,
} from './owner-brief.mjs'

const brief = [
  '🔴 **The velo preview deploy failed on the overlay probe**',
  '> 🤖 **Claude Code** · interactive agent · posted from @pmcp\'s account (not Maarten)',
  '',
  '**You:** nothing yet — fix is in #2074, I\'ll report when it\'s green.',
  '**Depth:** https://github.com/FriendlyInternet/nuxt-crouton/pull/2074',
].join('\n')

test('a well-shaped brief passes', () => {
  const v = checkOwnerBrief(brief)
  assert.equal(v.ok, true, JSON.stringify(v))
})

test('the anti-job: a HUMAN comment is untouched at any length', () => {
  const wall = Array.from({ length: 200 }, (_, i) => `line ${i} of deep technical analysis`).join('\n')
  const v = checkOwnerBrief(wall)
  assert.equal(v.ok, true, 'no 🤖 header → not an agent comment → not ours to shape')
  assert.ok(v.lines > MAX_VISIBLE_LINES && v.chars > MAX_VISIBLE_CHARS, 'sanity: it really is over both limits')
})

/*
 * THE TRIGGER. @mention was the obvious choice and the corpus killed it: 17 of the 29
 * owner-mentioning comments carry `@pmcp` ONLY inside the mandatory provenance disclaimer
 * ("posted from @pmcp's account") — precisely the long reports being complained about. An
 * @mention gate would have waved those through. These two pin the corrected trigger.
 */
test('a long report whose only @pmcp is the provenance disclaimer IS still gated', () => {
  const body = [
    "> 🤖 **Claude Code** · interactive agent · posted from @pmcp's account (not Maarten)",
    '', 'x'.repeat(MAX_VISIBLE_CHARS + 1),
  ].join('\n')
  const v = checkOwnerBrief(body)
  assert.equal(v.ok, false, 'this is the exact set the @mention trigger would have missed')
})

test('isAgentComment keys off the 🤖 header, wherever it sits', () => {
  assert.equal(isAgentComment('> 🤖 pipeline'), true)
  assert.equal(isAgentComment('just a person talking'), false)
})

test('a wall is refused, and the reason says which limit', () => {
  const wall = '🔴 **thing**\n> 🤖 x\n' + 'x'.repeat(MAX_VISIBLE_CHARS + 1)
  const v = checkOwnerBrief(wall)
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'too-long')
})

test('many short lines are refused on lines, not chars', () => {
  const many = ['🔴 **thing**', '> 🤖 x', ...Array.from({ length: 20 }, (_, i) => `- point ${i}`)].join('\n')
  const v = checkOwnerBrief(many)
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'too-many-lines')
  assert.ok(v.chars <= MAX_VISIBLE_CHARS, 'this case must be caught by the LINE limit')
})

test('no type marker is refused', () => {
  const v = checkOwnerBrief('> 🤖 agent\n\nCould you look at this when you get a chance?')
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'no-type')
})

test('every declared type is accepted as a marker', () => {
  for (const t of BRIEF_TYPES) {
    const v = checkOwnerBrief(`${t.emoji} **something**\n> 🤖 x\n**You:** nothing`)
    assert.equal(v.ok, true, `${t.emoji} ${t.name} should be a valid marker`)
  }
})

test('an emoji carrying a variation selector still matches', () => {
  // 🛠️ (U+1F6E0 U+FE0F) is what most keyboards produce; the table lists the bare 🛠.
  const v = checkOwnerBrief('🛠️ **apply this patch**\n> 🤖 x\n**You:** apply it')
  assert.equal(v.ok, true)
})

/* ── The collapse rule is the whole point: depth is free, it just can't be in front. ── */

test('DEPTH IS FREE — an arbitrarily long <details> costs nothing', () => {
  const deep = brief + '\n\n<details><summary>Findings</summary>\n' + 'y'.repeat(50_000) + '\n</details>'
  const v = checkOwnerBrief(deep)
  assert.equal(v.ok, true, 'collapsing must be a real escape hatch or agents will just cut content')
  assert.ok(v.chars < MAX_VISIBLE_CHARS)
})

test('a fenced code block costs nothing either', () => {
  const withCode = brief + '\n\n```\n' + 'z\n'.repeat(500) + '```'
  assert.equal(checkOwnerBrief(withCode).ok, true)
})

test('the provenance blockquote does not eat the budget', () => {
  const long = '> 🤖 ' + 'p'.repeat(600)
  assert.equal(visiblePart(long), '')
})

test('a fence INSIDE details is not double-counted into oblivion', () => {
  const nested = brief + '\n<details><summary>x</summary>\n\n```\ncode\n```\n\n</details>'
  const v = checkOwnerBrief(nested)
  assert.equal(v.ok, true)
})





/* ── The message has to teach the fix, or the gate just costs a round-trip. ── */

test('the block message names the fix, not only the violation', () => {
  const msg = explain(checkOwnerBrief('> 🤖 x\n\nlook at this'))
  assert.match(msg, /<details>/, 'must show the collapse escape hatch')
  assert.match(msg, /🔴/, 'must show the vocabulary')
  assert.match(msg, /Collapse it, don't cut it/, 'must say the depth is kept')
})

test('an empty body is not an agent comment and does not throw', () => {
  assert.equal(checkOwnerBrief('').ok, true)
  assert.equal(checkOwnerBrief(undefined).ok, true)
})
