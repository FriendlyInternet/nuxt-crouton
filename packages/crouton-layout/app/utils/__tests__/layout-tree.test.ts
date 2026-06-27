import { describe, it, expect } from 'vitest'
import { sanitizeLayoutTree } from '../layout-tree'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

const validTree: LayoutTree = {
  renderer: 'panes',
  root: {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', blockId: 'collection-list', defaultSize: 40 },
      { type: 'leaf', blockId: 'entity-form', config: { heading: 'Edit' } },
    ],
  },
}

describe('sanitizeLayoutTree — accepts well-formed trees', () => {
  it('passes a full { renderer, root } tree through', () => {
    expect(sanitizeLayoutTree(validTree)).toEqual(validTree)
  })

  it('accepts a bare root node and defaults renderer to panes', () => {
    expect(sanitizeLayoutTree(validTree.root)).toEqual(validTree)
  })

  it('accepts a single leaf root', () => {
    expect(sanitizeLayoutTree({ type: 'leaf', blockId: 'stats' })).toEqual({
      renderer: 'panes',
      root: { type: 'leaf', blockId: 'stats' },
    })
  })
})

describe('sanitizeLayoutTree — rejects / strips malformed input', () => {
  it('returns null for non-objects', () => {
    expect(sanitizeLayoutTree(null)).toBeNull()
    expect(sanitizeLayoutTree('hax')).toBeNull()
    expect(sanitizeLayoutTree(42)).toBeNull()
  })

  it('returns null for an unknown renderer', () => {
    expect(sanitizeLayoutTree({ renderer: 'vue-flow', root: validTree.root })).toBeNull()
  })

  it('returns null for a leaf without a blockId', () => {
    expect(sanitizeLayoutTree({ type: 'leaf' })).toBeNull()
    expect(sanitizeLayoutTree({ type: 'leaf', blockId: 123 })).toBeNull()
  })

  it('returns null for a split with a bad direction or no children', () => {
    expect(sanitizeLayoutTree({ type: 'split', direction: 'diagonal', children: [{ type: 'leaf', blockId: 'x' }] })).toBeNull()
    expect(sanitizeLayoutTree({ type: 'split', direction: 'horizontal', children: [] })).toBeNull()
  })

  it('invalidates a whole split if any child is bad (no silent holes)', () => {
    expect(sanitizeLayoutTree({
      type: 'split',
      direction: 'horizontal',
      children: [{ type: 'leaf', blockId: 'ok' }, { type: 'leaf' }],
    })).toBeNull()
  })

  it('drops unknown keys and prototype pollution, keeping only known fields', () => {
    const out = sanitizeLayoutTree({
      type: 'leaf',
      blockId: 'stats',
      evil: 'x',
      __proto__: { polluted: true },
      defaultSize: 50,
    })
    expect(out).toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'stats', defaultSize: 50 } })
    expect((out as unknown as Record<string, unknown>).evil).toBeUndefined()
  })

  it('drops out-of-range sizes', () => {
    const out = sanitizeLayoutTree({ type: 'leaf', blockId: 'stats', defaultSize: 999, minSize: -5 })
    expect(out).toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'stats' } })
  })

  it('keeps a valid collapse recipe, drops a partial/invalid one (#852)', () => {
    expect(sanitizeLayoutTree({ type: 'leaf', blockId: 'stats', collapse: { edge: 'left', affordance: 'dot' } }))
      .toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'stats', collapse: { edge: 'left', affordance: 'dot' } } })
    // partial (no affordance) / bogus values → dropped, not half-trusted
    expect(sanitizeLayoutTree({ type: 'leaf', blockId: 'stats', collapse: { edge: 'left' } }))
      .toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'stats' } })
    expect(sanitizeLayoutTree({ type: 'leaf', blockId: 'stats', collapse: { edge: 'sideways', affordance: 'tab' } }))
      .toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'stats' } })
  })

  it('rejects a tree nested past the depth cap', () => {
    let node: Record<string, unknown> = { type: 'leaf', blockId: 'deep' }
    for (let i = 0; i < 20; i++) {
      node = { type: 'split', direction: 'horizontal', children: [node] }
    }
    expect(sanitizeLayoutTree(node)).toBeNull()
  })
})

describe('sanitizeLayoutTree — recursive nested layouts (WS2 #871)', () => {
  const appLayout: LayoutTree = {
    renderer: 'panes',
    root: {
      type: 'split',
      direction: 'vertical',
      children: [
        { type: 'leaf', blockId: 'bookings-calendar' },
        { type: 'leaf', blockId: 'entity-form' },
      ],
    },
  }

  it('accepts a nested node hosting a sub-layout', () => {
    expect(sanitizeLayoutTree({ type: 'nested', layout: appLayout, label: 'Bookings' })).toEqual({
      renderer: 'panes',
      root: { type: 'nested', layout: appLayout, label: 'Bookings' },
    })
  })

  it('accepts a page-layout whose panes are app-layouts (layouts in layouts)', () => {
    const out = sanitizeLayoutTree({
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'nested', layout: appLayout },
        { type: 'leaf', blockId: 'stats' },
      ],
    })
    expect(out?.root).toMatchObject({ type: 'split' })
    expect((out!.root as { children: unknown[] }).children[0]).toMatchObject({
      type: 'nested',
      layout: { renderer: 'panes' },
    })
  })

  it('normalizes a bare-root sub-layout into a full tree', () => {
    expect(sanitizeLayoutTree({ type: 'nested', layout: { type: 'leaf', blockId: 'stats' } })).toEqual({
      renderer: 'panes',
      root: { type: 'nested', layout: { renderer: 'panes', root: { type: 'leaf', blockId: 'stats' } } },
    })
  })

  it('rejects a nested node whose sub-layout is missing or malformed (no silent hole)', () => {
    expect(sanitizeLayoutTree({ type: 'nested' })).toBeNull()
    expect(sanitizeLayoutTree({ type: 'nested', layout: { type: 'leaf' } })).toBeNull()
    expect(sanitizeLayoutTree({ type: 'nested', layout: { renderer: 'vue-flow', root: { type: 'leaf', blockId: 'x' } } })).toBeNull()
  })

  it('drops an empty label and out-of-range sizes on a nested node', () => {
    expect(sanitizeLayoutTree({
      type: 'nested',
      layout: { type: 'leaf', blockId: 'stats' },
      label: '',
      defaultSize: 999,
    })).toEqual({
      renderer: 'panes',
      root: { type: 'nested', layout: { renderer: 'panes', root: { type: 'leaf', blockId: 'stats' } } },
    })
  })

  it('counts nesting toward the depth cap (layouts-in-layouts can’t blow the stack)', () => {
    let layout: Record<string, unknown> = { renderer: 'panes', root: { type: 'leaf', blockId: 'deep' } }
    for (let i = 0; i < 20; i++) {
      layout = { renderer: 'panes', root: { type: 'nested', layout } }
    }
    expect(sanitizeLayoutTree(layout)).toBeNull()
  })
})

describe('sanitizeLayoutTree — authored breakpoints (WS5 #874)', () => {
  it('keeps well-formed breakpoints with only known fields', () => {
    const clean = sanitizeLayoutTree({
      renderer: 'panes',
      root: { type: 'leaf', blockId: 'list' },
      breakpoints: [
        { minWidth: 768, label: 'Tablet', collapsed: ['list'], variants: { list: 'cards' }, collapseStyle: 'gutter-tabs' },
      ],
    })
    expect(clean?.breakpoints).toEqual([
      { minWidth: 768, label: 'Tablet', collapsed: ['list'], variants: { list: 'cards' }, collapseStyle: 'gutter-tabs' },
    ])
  })

  it('drops a breakpoint without a finite non-negative minWidth, and strips stray keys', () => {
    const clean = sanitizeLayoutTree({
      renderer: 'panes',
      root: { type: 'leaf', blockId: 'list' },
      breakpoints: [
        { minWidth: -5, collapsed: ['list'] },
        { minWidth: 'wide' },
        { minWidth: 600, evil: 'x', variants: { a: 'cards', b: 2 } },
      ],
    })
    // Only the 600 survives; its non-string variant value and stray key are dropped.
    expect(clean?.breakpoints).toEqual([{ minWidth: 600, variants: { a: 'cards' } }])
  })

  it('omits the field entirely when no breakpoint is usable', () => {
    const clean = sanitizeLayoutTree({
      renderer: 'panes',
      root: { type: 'leaf', blockId: 'list' },
      breakpoints: [{ minWidth: -1 }, 'nope'],
    })
    expect(clean).toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'list' } })
    expect(clean && 'breakpoints' in clean).toBe(false)
  })

  it('keeps a known collapseStyle and drops an unknown one (WS6 #875)', () => {
    const clean = sanitizeLayoutTree({
      renderer: 'panes',
      root: { type: 'leaf', blockId: 'list' },
      breakpoints: [
        { minWidth: 600, collapsed: ['list'], collapseStyle: 'iris-portal' }, // valid → kept
        { minWidth: 900, collapsed: ['list'], collapseStyle: 'header-toggle' }, // never promoted → dropped
        { minWidth: 1200, collapsed: ['list'], collapseStyle: 42 }, // non-string → dropped
      ],
    })
    expect(clean?.breakpoints).toEqual([
      { minWidth: 600, collapsed: ['list'], collapseStyle: 'iris-portal' },
      { minWidth: 900, collapsed: ['list'] },
      { minWidth: 1200, collapsed: ['list'] },
    ])
  })

  it('validates a breakpoint root override through the node sanitizer', () => {
    const clean = sanitizeLayoutTree({
      renderer: 'panes',
      root: { type: 'leaf', blockId: 'list' },
      breakpoints: [
        { minWidth: 1024, root: { type: 'split', direction: 'vertical', children: [{ type: 'leaf', blockId: 'list' }, { type: 'leaf', blockId: 'form' }] } },
        { minWidth: 1280, root: { type: 'leaf', blockId: 123 } }, // invalid → root dropped, bp kept
      ],
    })
    expect(clean?.breakpoints?.[0]?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      children: [{ type: 'leaf', blockId: 'list' }, { type: 'leaf', blockId: 'form' }],
    })
    expect(clean?.breakpoints?.[1]).toEqual({ minWidth: 1280 })
  })
})
