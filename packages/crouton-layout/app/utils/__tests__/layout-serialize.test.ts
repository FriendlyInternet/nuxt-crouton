/**
 * #987 LayoutTree serialisation (graduation WS4) — the canonical, diffable
 * interchange format the agent⇄human layout loop rides on (#974 posts it onto a
 * ticket, #988 routes over it). Test-first per the #774 gate.
 *
 * The model + an UNTRUSTED-input gate already exist (`sanitizeLayoutTree`), so
 * this unit adds (A) a CANONICAL string form on top of sanitize, and (B) the
 * page-flow `LayoutDocument` wrapper. `parse*` REUSES `sanitizeLayoutTree`.
 *
 * Contract: 1 round-trip lossless · 2 canonical/stable · 3 defaults normalised ·
 * 4 size precision · 5 minimal diff · 6 untrusted-safe · 7 idempotent ·
 * 8 page-flow document round-trips.
 */
import { describe, it, expect } from 'vitest'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { sanitizeLayoutTree } from '@fyit/crouton-core/app/utils/layout-tree'
import {
  serializeLayoutTree,
  parseLayoutTree,
  serializeLayoutDocument,
  parseLayoutDocument,
  type LayoutDocument,
} from '../layout-serialize'

// Representative tree exercising every node kind + optional fields. Sizes are
// precision-clean (omitted) so the round-trip is byte-lossless; rounding gets its
// own fixture below.
const richTree: LayoutTree = {
  renderer: 'panes',
  root: {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', blockId: 'artists-list', config: { variant: 'rows' } },
      {
        type: 'split',
        direction: 'vertical',
        children: [
          { type: 'leaf', blockId: 'bookings-stat' },
          { type: 'leaf', blockId: 'revenue-stat' },
        ],
      },
      { type: 'nested', label: 'New artist', layout: {
        renderer: 'panes',
        root: { type: 'leaf', blockId: 'artists-form', collapse: { edge: 'right', affordance: 'tab' } },
      } },
    ],
  },
  breakpoints: [
    { minWidth: 320, label: 'Mobile', collapsed: ['revenue-stat'], variants: { 'artists-list': 'cards' } },
  ],
}

describe('#987 serializeLayoutTree / parseLayoutTree — canonical, diffable tree form', () => {
  it('1. round-trips losslessly (parse∘serialize === sanitize)', () => {
    const back = parseLayoutTree(serializeLayoutTree(richTree))
    expect(back).toEqual(sanitizeLayoutTree(richTree))
  })

  it('2. is canonical: key order in the INPUT does not change the OUTPUT', () => {
    const a: LayoutTree = { renderer: 'panes', root: { type: 'leaf', blockId: 'x', config: { variant: 'rows' } } }
    const b = { root: { config: { variant: 'rows' }, blockId: 'x', type: 'leaf' }, renderer: 'panes' } as unknown as LayoutTree
    expect(serializeLayoutTree(a)).toBe(serializeLayoutTree(b))
  })

  it('3. normalises defaults: omitted renderer / empty config serialise identically', () => {
    const omitted = parseLayoutTree('{"root":{"type":"leaf","blockId":"x"}}')!
    const explicit: LayoutTree = { renderer: 'panes', root: { type: 'leaf', blockId: 'x', config: {} } }
    expect(serializeLayoutTree(omitted)).toBe(serializeLayoutTree(explicit))
  })

  it('4. rounds arrangement sizes to 1 decimal place (stable diffs)', () => {
    const sized: LayoutTree = { renderer: 'panes', root: { type: 'split', direction: 'horizontal', children: [
      { type: 'leaf', blockId: 'a', defaultSize: 33.333333 },
      { type: 'leaf', blockId: 'b', defaultSize: 66.666666 },
    ] } }
    const s = serializeLayoutTree(sized)
    expect(s).toContain('33.3')
    expect(s).not.toContain('33.333333')
  })

  it('5. a one-leaf change produces a minimal textual diff', () => {
    const changed: LayoutTree = JSON.parse(JSON.stringify(richTree))
    ;(changed.root as { children: { blockId: string }[] }).children[0]!.blockId = 'artists-grid'
    const before = serializeLayoutTree(richTree).split('\n')
    const after = serializeLayoutTree(changed).split('\n')
    const differing = after.filter((line, i) => line !== before[i])
    expect(differing.length).toBeLessThanOrEqual(1)
  })

  it('6. parse sanitises untrusted input: stray keys dropped, malformed → null', () => {
    const dirty = '{"root":{"type":"leaf","blockId":"x","evil":1,"defaultSize":999}}'
    expect(parseLayoutTree(dirty)).toEqual({ renderer: 'panes', root: { type: 'leaf', blockId: 'x' } })
    expect(parseLayoutTree('not json')).toBeNull()
    expect(parseLayoutTree('{"root":{"type":"bogus"}}')).toBeNull()
  })

  it('7. is idempotent: serialize∘parse∘serialize === serialize', () => {
    const once = serializeLayoutTree(richTree)
    expect(serializeLayoutTree(parseLayoutTree(once)!)).toBe(once)
  })

  it('accepts a parsed object (not only a string) so callers can round-trip either form', () => {
    const obj = JSON.parse(serializeLayoutTree(richTree))
    expect(parseLayoutTree(obj)).toEqual(sanitizeLayoutTree(richTree))
  })
})

// The page-flow wrapper — the Site level (pages wired by parentId, one ★home),
// each page carrying its composed tree + assembled pinned regions.
const doc: LayoutDocument = {
  version: 1,
  pages: [
    {
      id: 'p_dashboard', name: 'Dashboard', path: '/dashboard', isHome: true,
      status: 'published', visibility: 'public', layout: 'default', inNav: true,
      tree: { renderer: 'panes', root: { type: 'leaf', blockId: 'artists-list' } },
      pinnedTop: [{ renderer: 'panes', root: { type: 'leaf', blockId: 'top-bar' } }],
      pinnedBottom: [{ renderer: 'panes', root: { type: 'leaf', blockId: 'bottom-nav' } }],
    },
    {
      id: 'p_reports', name: 'Reports', path: '/reports', parentId: 'p_dashboard',
      status: 'draft', visibility: 'members', layout: 'full-height', inNav: false,
      tree: { renderer: 'panes', root: { type: 'leaf', blockId: 'revenue-stat' } },
    },
  ],
}

describe('#987 serializeLayoutDocument / parseLayoutDocument — the page-flow interchange', () => {
  it('8a. round-trips the document losslessly', () => {
    expect(parseLayoutDocument(serializeLayoutDocument(doc))).toEqual(doc)
  })

  it('8b. preserves the site-flow edges (parentId) and exactly one ★home', () => {
    const back = parseLayoutDocument(serializeLayoutDocument(doc))!
    expect(back.pages.find(p => p.id === 'p_reports')!.parentId).toBe('p_dashboard')
    expect(back.pages.filter(p => p.isHome)).toHaveLength(1)
  })

  it('8c. preserves pinned regions as assembled trees (top / main / bottom)', () => {
    const back = parseLayoutDocument(serializeLayoutDocument(doc))!
    const home = back.pages.find(p => p.isHome)!
    expect(home.pinnedTop?.[0]?.root).toEqual({ type: 'leaf', blockId: 'top-bar' })
    expect(home.pinnedBottom?.[0]?.root).toEqual({ type: 'leaf', blockId: 'bottom-nav' })
  })

  it('8d. is canonical + diffable: idempotent, page order preserved', () => {
    const s = serializeLayoutDocument(doc)
    expect(s).toBe(serializeLayoutDocument(parseLayoutDocument(s)!))
    expect(s.indexOf('p_dashboard')).toBeLessThan(s.indexOf('p_reports'))
  })

  it('8e. sanitises untrusted pages: drops a page with no valid tree, malformed doc → null', () => {
    const dirty = JSON.stringify({ version: 1, pages: [
      { id: 'ok', name: 'OK', path: '/ok', tree: { root: { type: 'leaf', blockId: 'x' } } },
      { id: 'bad', name: 'Bad', path: '/bad', tree: { root: { type: 'nonsense' } } },
    ] })
    expect(parseLayoutDocument(dirty)!.pages.map(p => p.id)).toEqual(['ok'])
    expect(parseLayoutDocument('garbage')).toBeNull()
  })
})
