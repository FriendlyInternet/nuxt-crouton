import { describe, it, expect } from 'vitest'
import { walkEntries, stepsOf, selectorFor, exportText, type VerdictMap } from '../src/runtime/tools/specwalk-data'
import { createSpecWalkTool } from '../src/runtime/tools/specwalk'
import type { ComposedPlan } from '../src/runtime/tools/plan-data'

// A composed plan the way the module ships it into runtimeConfig: phases/increments
// tagged with status, specs already resolved to full entries with a bucket.
const plan = {
  title: 'Graduation Plan',
  badge: 'B2',
  phases: [
    {
      id: 'A', name: 'Contract', status: 'done',
      specs: [{ id: 'spec-a', behaviour: 'A behaviour', expect: 'a expect', hook: 'hook-a', howToTest: '1. do a', status: 'settled', bucket: 'Preserve' }]
    },
    {
      id: 'B', name: 'Build', status: 'active',
      increments: [
        { id: 'B1', status: 'done', specs: [{ id: 'spec-b1', behaviour: 'B1 behaviour', hook: 'hook-b1', howToTest: '1. do b1', bucket: 'Preserve' }] },
        { id: 'B2', status: 'active', specs: [{ id: 'spec-b2', behaviour: 'B2 behaviour', bucket: 'Add' }] },
        { id: 'B3', status: 'next', specs: [{ id: 'spec-b3', behaviour: 'deferred', bucket: 'Add' }] }
      ]
    },
    {
      id: 'C', name: 'Later', status: 'later',
      specs: [{ id: 'spec-c', behaviour: 'not shipped', bucket: 'Add' }]
    }
  ]
} as unknown as ComposedPlan

describe('walkEntries', () => {
  it('flattens only LIVE (done/active) phases + increments', () => {
    const ids = walkEntries(plan).map(e => e.id)
    // A (done phase), B1 (done inc), B2 (active inc) — NOT B3 (next) or C (later)
    expect(ids).toEqual(['spec-a', 'spec-b1', 'spec-b2'])
  })

  it('carries behaviour/expect/hook/howToTest/bucket through', () => {
    const a = walkEntries(plan)[0]!
    expect(a).toMatchObject({
      id: 'spec-a', behaviour: 'A behaviour', expect: 'a expect',
      hook: 'hook-a', howToTest: '1. do a', bucket: 'Preserve'
    })
  })

  it('dedupes an id listed under both a phase and its increment (first wins)', () => {
    const dup = { phases: [
      { id: 'B', status: 'active', specs: [{ id: 'shared', behaviour: 'phase copy' }],
        increments: [{ id: 'B1', status: 'active', specs: [{ id: 'shared', behaviour: 'inc copy' }] }] }
    ] } as unknown as ComposedPlan
    const out = walkEntries(dup)
    expect(out).toHaveLength(1)
    expect(out[0]!.behaviour).toBe('phase copy')
  })

  it('skips entries with no id and tolerates malformed input', () => {
    expect(walkEntries({ phases: [{ id: 'X', status: 'done', specs: [{ behaviour: 'no id' }] }] } as unknown as ComposedPlan)).toEqual([])
    expect(walkEntries(null)).toEqual([])
    expect(walkEntries({} as ComposedPlan)).toEqual([])
  })
})

describe('stepsOf', () => {
  it('splits a numbered howToTest string into steps, stripping the markers', () => {
    expect(stepsOf({ howToTest: '1. open a board  2. drag the block  3. release near the edge' }))
      .toEqual(['open a board', 'drag the block', 'release near the edge'])
  })

  it('strips a GRADUATED: prefix and handles a single step / empty', () => {
    expect(stepsOf({ howToTest: 'GRADUATED: 1. just this' })).toEqual(['just this'])
    expect(stepsOf({ howToTest: '' })).toEqual([])
  })
})

describe('selectorFor', () => {
  it('maps a hook (with optional attribute suffix) to its data-handoff selector', () => {
    expect(selectorFor('ghost-pane[data-edge]')).toBe('[data-handoff="ghost-pane"]')
    expect(selectorFor('spec-walk')).toBe('[data-handoff="spec-walk"]')
    expect(selectorFor('')).toBe('')
  })
})

describe('exportText', () => {
  const walk = walkEntries(plan)

  it('emits lgtm <id> for each ✅, then the ⚠️ issues with notes', () => {
    const verdicts: VerdictMap = {
      'spec-a': { verdict: 'works' },
      'spec-b1': { verdict: 'issue', note: 'ghost is off-center' },
      'spec-b2': { verdict: 'works' }
    }
    expect(exportText(walk, verdicts)).toBe('lgtm spec-a\nlgtm spec-b2\n\n⚠️ spec-b1 — ghost is off-center')
  })

  it('is explicit when nothing is marked', () => {
    expect(exportText(walk, {})).toBe('(nothing marked yet)')
  })
})

describe('createSpecWalkTool', () => {
  it('describes the row, badges marked/total, hides when nothing to walk', () => {
    const tool = createSpecWalkTool({ count: () => 3, getBadge: () => '1/3', setOpen: () => {} })
    expect(tool.id).toBe('specwalk')
    expect(tool.label).toBe('Spec walk')
    expect(tool.isAvailable!()).toBe(true)
    expect(tool.badge!()).toBe('1/3')

    const empty = createSpecWalkTool({ count: () => 0, getBadge: () => null, setOpen: () => {} })
    expect(empty.isAvailable!()).toBe(false)
  })

  it('opens and closes via activate/deactivate', () => {
    let open = false
    const tool = createSpecWalkTool({ count: () => 1, getBadge: () => '0/1', setOpen: (v) => { open = v } })
    tool.activate!(); expect(open).toBe(true)
    tool.deactivate!(); expect(open).toBe(false)
  })
})
