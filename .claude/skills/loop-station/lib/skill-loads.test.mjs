/**
 * node --test .claude/skills/loop-station/lib/skill-loads.test.mjs   (#2403)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skillLoadsFromSession, skillNameFromPath } from './skill-loads.mjs'

const rec = (content, role = 'assistant', timestamp = '2026-10-24T09:32:00.000Z') =>
  JSON.stringify({ type: 'message', timestamp, message: { role, content } })
const read = (path, extra = {}) => ({ type: 'toolCall', name: 'read', arguments: { path, ...extra } })

test('a read of a SKILL.md or a root skill .md is a skill load named like the inventory', () => {
  assert.equal(skillNameFromPath('/w/repo/.claude/skills/commit/SKILL.md'), 'commit')
  assert.equal(skillNameFromPath('.claude/skills/crouton.md'), 'crouton')
  assert.equal(skillNameFromPath('C:\\w\\.claude\\skills\\deploy\\SKILL.md'), 'deploy')
})

test('sub-docs inside a skill dir and ordinary files are not skill loads', () => {
  assert.equal(skillNameFromPath('.claude/skills/commit/examples.md'), null)
  assert.equal(skillNameFromPath('.claude/skills/SKILL.md'), null)
  assert.equal(skillNameFromPath('packages/x/CLAUDE.md'), null)
  assert.equal(skillNameFromPath(undefined), null)
})

test('session → one event per load, name + ts only; other tools and non-skill reads ignored', () => {
  const text = [
    rec([read('/w/.claude/skills/commit/SKILL.md')]),
    rec([{ type: 'toolCall', name: 'bash', arguments: { command: 'cat .claude/skills/deploy/SKILL.md' } }]),
    rec([read('/w/packages/crouton-core/CLAUDE.md')]),
    rec([read('/w/.claude/skills/crouton.md')], 'assistant', '2026-10-24T09:33:00.000Z'),
    '', 'not json',
  ].join('\n')
  const events = skillLoadsFromSession(text)
  assert.deepEqual(events, [
    { ts: '2026-10-24T09:32:00.000Z', kind: 'skill', name: 'commit', parent: 'root', depth: 0 },
    { ts: '2026-10-24T09:33:00.000Z', kind: 'skill', name: 'crouton', parent: 'root', depth: 0 },
  ])
  for (const e of events) assert.deepEqual(Object.keys(e).sort(), ['depth', 'kind', 'name', 'parent', 'ts'])
})

test('a continuation read (offset > 0) of the same skill file is not a second load', () => {
  const text = [
    rec([read('/w/.claude/skills/graduate/SKILL.md')]),
    rec([read('/w/.claude/skills/graduate/SKILL.md', { offset: 2000, limit: 2000 })]),
    rec([read('/w/.claude/skills/graduate/SKILL.md', { offset: 0 })]), // a fresh load later
  ].join('\n')
  assert.equal(skillLoadsFromSession(text).length, 2)
})

test('a /skill:name expansion in a user message counts as a load', () => {
  const text = rec([{ type: 'text', text: '<skill name="commit" location="/w/.claude/skills/commit/SKILL.md">\nbody\n</skill>' }], 'user')
  assert.deepEqual(skillLoadsFromSession(text).map((e) => e.name), ['commit'])
})

test('empty input → no events', () => {
  assert.deepEqual(skillLoadsFromSession(''), [])
  assert.deepEqual(skillLoadsFromSession(undefined), [])
})
