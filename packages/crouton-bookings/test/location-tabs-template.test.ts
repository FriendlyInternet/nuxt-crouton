/**
 * #4471 — one shared location tab row (CroutonBookingsLocationTabs), wired into the
 * panel, the composed-page filters and the booking form. Reads the real .vue files
 * (the SFCs need the Nuxt UI runtime to mount), same style as
 * booking-create-card-template.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const ELEMENT = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

type Node = any

function load(name: string) {
  const file = resolve(__dirname, `../app/components/${name}`)
  const source = readFileSync(file, 'utf8')
  const { descriptor, errors } = parse(source, { filename: file })
  expect(errors).toEqual([])
  return { source, ast: descriptor.template!.ast!, template: descriptor.template!.content }
}

type Hit = { node: Node, anc: Node[] }

const elements = (node: Node): Node[] => (node.children ?? []).filter((c: Node) => c.type === ELEMENT)

/** Every element under `node`, with its ancestors */
function allElements(node: Node, anc: Node[] = []): Hit[] {
  return elements(node).flatMap(child => [{ node: child, anc }, ...allElements(child, [...anc, child])])
}

const find = (ast: Node, tag: string): Hit[] => allElements(ast).filter(h => h.node.tag === tag)

const propsOf = (node: Node): Node[] => node.props ?? []
const argOf = (p: Node): string | undefined => p.arg?.content
const isDirective = (p: Node, name: string) => p.type === DIRECTIVE && p.name === name
const matchesArg = (p: Node, arg?: string) => arg === undefined || argOf(p) === arg
const isAttr = (p: Node, name: string) => p.type === ATTRIBUTE && p.name === name
const isBind = (p: Node, name: string) => isDirective(p, 'bind') && argOf(p) === name
const isPlusIcon = (p: Node) => isAttr(p, 'icon') && p.value?.content === 'i-lucide-plus'

function directive(node: Node, name: string, arg?: string): string | undefined {
  return propsOf(node).find(p => isDirective(p, name) && matchesArg(p, arg))?.exp?.content
}

const hasProp = (node: Node, name: string): boolean => propsOf(node).some(p => isAttr(p, name) || isBind(p, name))

const tabs = load('LocationTabs.vue')
const panel = load('Panel.vue')
const filters = load('PanelFilters.vue')
const card = load('BookingCreateCard.vue')

describe('CroutonBookingsLocationTabs (#4471)', () => {
  // covers: T4
  it('(a) one UTabs that scrolls sideways and never squeezes a tab', () => {
    const hits = find(tabs.ast, 'UTabs')
    expect(hits).toHaveLength(1)
    const ui = directive(hits[0]!.node, 'bind', 'ui') ?? ''
    expect(ui).toContain('SCROLL_ROW_X')
    expect(ui).toContain('min-w-fit')
  })

  // covers: T4
  it('(b) no tabs with one location', () => {
    const { node, anc } = find(tabs.ast, 'UTabs')[0]!
    const conds = [node, ...anc].map((n: Node) => directive(n, 'if') ?? '')
    expect(conds.some(c => c.includes('locations.length > 1'))).toBe(true)
  })

  // covers: T4
  it('(c) the "+" sits outside the tabs and emits add', () => {
    const plus = find(tabs.ast, 'UButton').filter(h => propsOf(h.node).some(isPlusIcon))
    expect(plus).toHaveLength(1)
    expect(plus[0]!.anc.some((a: Node) => a.tag === 'UTabs')).toBe(false)
    expect(directive(plus[0]!.node, 'on', 'click')).toMatch(/emit\('add'\)/)
  })

  // covers: T4
  it('(d) Panel renders it under the calendar, above the scroll area, with "All"', () => {
    const src = panel.template
    const at = src.indexOf('<CroutonBookingsLocationTabs')
    expect(at).toBeGreaterThan(src.indexOf('<CroutonBookingsCalendar'))
    expect(at).toBeLessThan(src.indexOf('Scroll area'))
    const row = find(panel.ast, 'CroutonBookingsLocationTabs')
    expect(row).toHaveLength(1)
    expect(hasProp(row[0]!.node, 'show-all')).toBe(true)
    expect(directive(row[0]!.node, 'on', 'update:model-value')).toContain('locationsFor(')
    // outside the calendar's v-if, so it stays when the calendar folds
    expect(row[0]!.anc.some((a: Node) => (directive(a, 'if') ?? '').includes('showCalendar'))).toBe(false)
  })

  // covers: T4
  it('(e) PanelFilters renders it only on composed pages and no longer merges ids', () => {
    const row = find(filters.ast, 'CroutonBookingsLocationTabs')
    expect(row).toHaveLength(1)
    expect(directive(row[0]!.node, 'if')).toContain('!viewToggles')
    expect(directive(row[0]!.node, 'on', 'update:model-value')).toContain('locationsFor(')
    expect(filters.source).not.toContain('toggleLocation')
  })

  // covers: T4
  it('(f) the booking form uses it without "All" or "+"', () => {
    const row = find(card.ast, 'CroutonBookingsLocationTabs')
    expect(row).toHaveLength(1)
    expect(hasProp(row[0]!.node, 'show-all')).toBe(false)
    expect(hasProp(row[0]!.node, 'can-add')).toBe(false)
  })

  // covers: T4
  it('(g) every locale has bookings.filters.all', () => {
    for (const lang of ['en', 'nl', 'fr']) {
      const json = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${lang}.json`), 'utf8'))
      expect(typeof json.bookings.filters.all).toBe('string')
      expect(json.bookings.filters.all.length).toBeGreaterThan(0)
    }
  })
})
