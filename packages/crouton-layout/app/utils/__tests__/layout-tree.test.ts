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

  it('rejects a tree nested past the depth cap', () => {
    let node: Record<string, unknown> = { type: 'leaf', blockId: 'deep' }
    for (let i = 0; i < 20; i++) {
      node = { type: 'split', direction: 'horizontal', children: [node] }
    }
    expect(sanitizeLayoutTree(node)).toBeNull()
  })
})
