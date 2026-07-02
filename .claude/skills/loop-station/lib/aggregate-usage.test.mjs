/**
 * Tests for the WS-A usage aggregator + append idempotence key (#1064).
 *   node --test .claude/skills/loop-station/lib/aggregate-usage.test.mjs
 *
 * The rollup is the usage side of the dead-weight join, so its counting must be
 * predictable: counts sum across runs; run/workflow attribution comes from each
 * file's meta line; zero input yields a visible meta-only record, never silence;
 * and the committed record carries its scope so a consumer can't over-read it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregate } from '../aggregate-usage.mjs'
import { isoWeek } from '../append-usage.mjs'

const NOW = '2026-07-06T06:30:00.000Z'

const traceFile = (run, workflow, events) =>
  [
    JSON.stringify({ kind: 'meta', generatedAt: NOW, run, workflow, eventCount: events.length }),
    ...events.map((e) => JSON.stringify({ run, ...e }))
  ].join('\n') + '\n'

const ev = (kind, name, ts = '2026-07-05T10:00:00.000Z') => ({ ts, kind, name, parent: 'root', depth: 1 })

test('counts sum across runs; run/workflow attribution from meta', () => {
  const a = traceFile('111', 'claude.yml', [ev('skill', 'commit'), ev('tool', 'Bash'), ev('skill', 'commit')])
  const b = traceFile('222', 'a11y.yml', [ev('skill', 'commit'), ev('agent', 'a11y')])
  const r = aggregate([a, b], { windowDays: 7, now: NOW })

  assert.equal(r.runs, 2)
  assert.deepEqual(r.workflows, ['a11y.yml', 'claude.yml'])
  assert.equal(r.events, 5)
  assert.equal(r.byName.commit.count, 3)
  assert.equal(r.byName.commit.runs, 2)
  assert.deepEqual(r.byName.commit.workflows, ['a11y.yml', 'claude.yml'])
  assert.equal(r.byName.a11y.kind, 'agent')
  assert.equal(r.byName.Bash.count, 1)
})

test('zero input → meta-only record, not silence', () => {
  const r = aggregate([], { windowDays: 7, now: NOW })
  assert.equal(r.runs, 0)
  assert.equal(r.events, 0)
  assert.deepEqual(r.byName, {})
  assert.ok(r.note, 'a quiet window is stated, not implied')
})

test('record names its provenance and scope (the #1065 badge reads these)', () => {
  const r = aggregate([], { now: NOW })
  assert.equal(r.source, 'ci-rollup')
  assert.equal(r.scope, 'pipeline')
  assert.equal(r.windowDays, 7)
  assert.equal(r.generatedAt, NOW)
})

test('first/lastSeen span the window; corrupt lines are tolerated', () => {
  const good = traceFile('333', 'red-team.yml', [
    ev('skill', 'red-team', '2026-07-01T00:00:00.000Z'),
    ev('skill', 'red-team', '2026-07-04T00:00:00.000Z')
  ])
  const r = aggregate([good + '{not json\n', ''], { now: NOW })
  assert.equal(r.byName['red-team'].count, 2)
  assert.equal(r.byName['red-team'].firstSeen, '2026-07-01T00:00:00.000Z')
  assert.equal(r.byName['red-team'].lastSeen, '2026-07-04T00:00:00.000Z')
})

test('a name seen as tool and skill keeps the skill labelling', () => {
  const t = traceFile('444', 'claude.yml', [ev('tool', 'commit'), ev('skill', 'commit')])
  const r = aggregate([t], { now: NOW })
  assert.equal(r.byName.commit.kind, 'skill')
  assert.equal(r.byName.commit.count, 2)
})

test('isoWeek: the append idempotence unit', () => {
  assert.equal(isoWeek('2026-07-06T06:30:00.000Z'), isoWeek('2026-07-12T23:59:59.000Z')) // same ISO week (Mon–Sun)
  assert.notEqual(isoWeek('2026-07-06T06:30:00.000Z'), isoWeek('2026-07-13T00:00:01.000Z')) // next week
  assert.equal(isoWeek('not a date'), null)
})
