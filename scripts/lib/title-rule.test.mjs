import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkTitle, componentNames, titleNotes, MAX_TITLE } from './title-rule.mjs'

const CLI = fileURLToPath(new URL('./title-rule.mjs', import.meta.url))
const LABELS = readFileSync(fileURLToPath(new URL('../../.github/labels.yml', import.meta.url)), 'utf8')

test('componentNames reads app/poc/pkg labels from the real labels.yml', () => {
  const c = componentNames(LABELS)
  for (const n of ['velo', 'crouton-pages', 'crouton-sales', 'gallery']) assert.ok(c.has(n), n)
  assert.ok(!c.has('feat'))
})

test('T1: a plain sentence, and a colon mid-sentence, are ok', () => {
  assert.deepEqual(checkTitle("A disabled button looks disabled: grey, not the button's colour"), { ok: true, problems: [] })
  assert.deepEqual(checkTitle('Failure numbers, step 2: count the runs that ended with no artifact'), { ok: true, problems: [] })
})

test('T2: area and commit-type prefixes are flagged (components from the real labels.yml)', () => {
  for (const t of [
    'Velo: the bookings cancel route returns 404',
    'crouton-pages: the editor loses its place',
    'fix(crouton-sales): totals round wrong',
    'fix(crouton-audio,crouton-editor): playback stops',
    'docs: rewrite section 2',
  ]) assert.ok(checkTitle(t).problems.includes('prefix'), t)
})

test('T3: 140 characters is ok, 141 is too long; an emoji counts as one', () => {
  assert.equal(checkTitle('a'.repeat(MAX_TITLE)).ok, true)
  assert.deepEqual(checkTitle('a'.repeat(MAX_TITLE + 1)).problems, ['too long'])
  assert.equal(checkTitle('🧪' + 'a'.repeat(MAX_TITLE - 1)).ok, true)
})

test('notes CLI lists failing tickets, or none, and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'title-rule-'))
  const f = join(dir, 'tickets.json')
  writeFileSync(f, JSON.stringify([{ number: 1, title: 'velo: broken' }, { number: 2, title: 'A plain title' }]))
  const out = execFileSync('node', [CLI, 'notes', f], { encoding: 'utf8' })
  assert.match(out, /## Automatic title check/)
  assert.match(out, /#1 "velo: broken" — prefix/)
  assert.doesNotMatch(out, /#2/)
  assert.match(titleNotes([{ number: 2, title: 'A plain title' }]), /\nnone\n/)
})
