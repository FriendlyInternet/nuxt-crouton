import { describe, it, expect } from 'vitest'
import { planBadge, planTitle, composePlan } from '../src/runtime/tools/plan-data'
import { createPlanTool } from '../src/runtime/tools/plan'

describe('planBadge', () => {
  it('returns the active increment id inside the active phase', () => {
    const raw = {
      phases: [
        { id: 'A', status: 'done' },
        { id: 'B', status: 'active', increments: [
          { id: 'B1', status: 'done' },
          { id: 'B2', status: 'active' },
          { id: 'B3', status: 'next' }
        ] },
        { id: 'C', status: 'blocked' }
      ]
    }
    expect(planBadge(raw)).toBe('B2')
  })

  it('falls back to the active phase id when it has no active increment', () => {
    expect(planBadge({ phases: [{ id: 'B', status: 'active' }] })).toBe('B')
    expect(planBadge({ phases: [{ id: 'B', status: 'active', increments: [{ id: 'B1', status: 'done' }] }] })).toBe('B')
  })

  it('returns null when nothing is active or input is malformed', () => {
    expect(planBadge({ phases: [{ id: 'A', status: 'done' }] })).toBeNull()
    expect(planBadge({})).toBeNull()
    expect(planBadge(null)).toBeNull()
    expect(planBadge('nope')).toBeNull()
  })
})

describe('planTitle', () => {
  it('uses the plan title, else the fallback', () => {
    expect(planTitle({ title: 'Graduation Plan' })).toBe('Graduation Plan')
    expect(planTitle({}, 'Plan')).toBe('Plan')
    expect(planTitle(null)).toBe('Plan')
  })
})

describe('composePlan', () => {
  const plan = {
    title: 'Graduation Plan',
    intro: 'the intro',
    epic: 983,
    pr: 1124,
    statusLegend: { done: 'landed' },
    phases: [
      { id: 'A', name: 'Contract', status: 'done', steps: [{ name: 'A0', status: 'done', test: 't' }] },
      { id: 'B', name: 'Build', status: 'active', increments: [
        { id: 'B1', name: 'Spine', status: 'done', flow: 'sequential', specs: ['site-two-level', 'missing-id'] }
      ] }
    ]
  }
  const spec = [
    { id: 'site-two-level', behaviour: 'Two levels', expect: 'shows both', hook: 'x[data-h]', howToTest: '1. open', status: 'settled', signedOff: 'lgtm v1' }
  ]

  it('joins spec ids to full entries tagged with their bucket', () => {
    const out = composePlan(plan, spec)
    const b1 = out.phases[1]!.increments[0]!
    expect(b1.specs[0]).toMatchObject({ id: 'site-two-level', behaviour: 'Two levels', bucket: 'Preserve', signedOff: 'lgtm v1' })
  })

  it('falls back to the id as behaviour for an unknown spec id', () => {
    const out = composePlan(plan, spec)
    expect(out.phases[1]!.increments[0]!.specs[1]).toMatchObject({ id: 'missing-id', behaviour: 'missing-id' })
  })

  it('carries title/intro/epic/pr/legend and a stable shape with no spec ledger', () => {
    const out = composePlan(plan, null)
    expect(out.title).toBe('Graduation Plan')
    expect(out.epic).toBe(983)
    expect(out.pr).toBe(1124)
    expect(out.intro).toBe('the intro')
    expect(out.statusLegend).toEqual({ done: 'landed' })
    expect(out.phases[0]!.steps[0]).toEqual({ name: 'A0', status: 'done', test: 't' })
    // unknown ledger → ids still resolve to their own titles
    expect(out.phases[1]!.increments[0]!.specs[0]!.behaviour).toBe('site-two-level')
  })

  it('tolerates malformed input', () => {
    expect(composePlan(null, null).phases).toEqual([])
    expect(composePlan({}, 'nope').title).toBe('Plan')
  })
})

describe('createPlanTool', () => {
  it('describes the menu row and badges the active phase', () => {
    const tool = createPlanTool({
      hasPlan: () => true,
      getBadge: () => 'B2',
      setOpen: () => {}
    })
    expect(tool.id).toBe('plan')
    expect(tool.label).toBe('Plan')
    expect(tool.isAvailable!()).toBe(true)
    expect(tool.badge!()).toBe('B2')
  })

  it('hides itself when no plan is configured', () => {
    const tool = createPlanTool({
      hasPlan: () => false,
      getBadge: () => null,
      setOpen: () => {}
    })
    expect(tool.isAvailable!()).toBe(false)
    expect(tool.badge!()).toBeNull()
  })

  it('opens and closes via activate/deactivate', () => {
    let open = false
    const tool = createPlanTool({
      hasPlan: () => true,
      getBadge: () => 'B2',
      setOpen: (v) => { open = v }
    })
    tool.activate!()
    expect(open).toBe(true)
    tool.deactivate!()
    expect(open).toBe(false)
  })
})
