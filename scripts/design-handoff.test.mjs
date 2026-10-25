import { test } from 'node:test'
import assert from 'node:assert/strict'
import { END, START, readmeFor, sectionFor, titleOf, upsertSection } from './design-handoff.mjs'

test('titles boards from file names', () => {
  assert.equal(titleOf('/x/login-error_state.png'), 'login error state')
})

test('README names every file', () => {
  const r = readmeFor('2421', ['a.png', 'b.png'])
  assert.match(r, /`a\.png`/)
  assert.match(r, /`b\.png`/)
})

test('section embeds raw image URLs on the given branch', () => {
  const s = sectionFor('2421', ['a.png'], { repo: 'o/r', branch: 'work-1' })
  assert.ok(s.includes('https://raw.githubusercontent.com/o/r/work-1/writeups/design/2421/a.png'))
})

test('upsert appends once, then replaces in place', () => {
  const appended = upsertSection('body', `${START}\nv1\n${END}`)
  assert.ok(appended.includes('body'))
  const replaced = upsertSection(appended, `${START}\nv2\n${END}`)
  assert.ok(replaced.includes('v2'))
  assert.ok(!replaced.includes('v1'))
  assert.equal(replaced.split(START).length, 2)
})
