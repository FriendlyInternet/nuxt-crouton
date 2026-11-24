/**
 * #4492 — "Show cancelled" and "Map" are text toggles on the first month label of the
 * bookings list (Panel only), and stay reachable when the list is loading, errored or empty.
 * Reads the real .vue files (the SFCs need the Nuxt UI runtime to mount), same style as
 * location-tabs-template.test.ts.
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
  return {
    source,
    script: descriptor.scriptSetup?.content ?? '',
    ast: descriptor.template!.ast!,
  }
}

type Hit = { node: Node, anc: Node[] }

const elements = (node: Node): Node[] => (node.children ?? []).filter((c: Node) => c.type === ELEMENT)

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

function directive(node: Node, name: string, arg?: string): string | undefined {
  return propsOf(node).find(p => isDirective(p, name) && matchesArg(p, arg))?.exp?.content
}

const hasProp = (node: Node, name: string): boolean => propsOf(node).some(p => isAttr(p, name) || isBind(p, name))

/** The text inside an element (interpolations included) */
const textOf = (node: Node): string => (node.children ?? []).map((c: Node) => c.content?.content ?? c.content ?? '').join('')

const toggles = load('ListToggles.vue')
const list = load('List.vue')
const panel = load('Panel.vue')
const layoutList = load('Layout/List.vue')

const root = elements(list.ast)[0]
const listHits = find(list.ast, 'CroutonBookingsListToggles')

describe('CroutonBookingsListToggles (#4492)', () => {
  // covers: T1
  it('Show cancelled always, Map only with coordinates; each flips its own value', () => {
    const buttons = find(toggles.ast, 'UButton').map(h => h.node)
    expect(buttons).toHaveLength(2)
    const cancelled = buttons.find(b => textOf(b).includes('bookings.filters.cancelled'))!
    const map = buttons.find(b => textOf(b).includes('bookings.filters.map'))!
    expect(cancelled).toBeTruthy()
    expect(map).toBeTruthy()

    expect(directive(cancelled, 'if')).toBeUndefined()
    expect(directive(map, 'if')).toBe('canShowMap')

    expect(directive(cancelled, 'on', 'click')).toMatch(/emit\('update:showCancelled', !showCancelled\)/)
    expect(directive(map, 'on', 'click')).toMatch(/emit\('update:showMap', !showMap\)/)

    expect(directive(cancelled, 'bind', 'aria-pressed')).toBe('showCancelled')
    expect(directive(map, 'bind', 'aria-pressed')).toBe('showMap')
  })

  // covers: T1
  it('List.vue puts the toggles on the FIRST month separator only', () => {
    const inList = listHits.filter(h => h.anc.some(a => directive(a, 'for')?.includes('groupedBookings')))
    expect(inList).toHaveLength(1)
    const loop = inList[0]!.anc.find(a => directive(a, 'for')?.includes('groupedBookings'))!
    expect(directive(loop, 'for')).toMatch(/\(monthGroup, monthIndex\) in groupedBookings/)
    expect(directive(inList[0]!.node, 'if')).toBe('listToggles && monthIndex === 0')
    for (const [prop, value] of [['show-cancelled', 'showCancelled'], ['show-map', 'showMap'], ['can-show-map', 'canShowMap']]) {
      expect(directive(inList[0]!.node, 'bind', prop)).toBe(value)
    }
    expect(directive(inList[0]!.node, 'on', 'update:show-cancelled')).toMatch(/emit\('update:showCancelled', \$event\)/)
    expect(directive(inList[0]!.node, 'on', 'update:show-map')).toMatch(/emit\('update:showMap', \$event\)/)
  })

  // covers: T2
  it('a top row shows the toggles when no month label is (loading, error, empty)', () => {
    const top = listHits.filter(h => !h.anc.some(a => directive(a, 'for')?.includes('groupedBookings')))
    expect(top).toHaveLength(1)
    const wrapper = top[0]!.anc.at(-1)!
    // a direct child of the root, before the loading branch, outside the v-if chain
    const children = elements(root)
    expect(children[0]).toBe(wrapper)
    expect(directive(wrapper, 'if')).toBe('listToggles && !showsMonthSeparator')
    expect(directive(children[1], 'if')).toBe('resolvedLoading')

    const computedBody = list.script.slice(list.script.indexOf('const showsMonthSeparator'))
    const body = computedBody.slice(0, computedBody.indexOf('\n)\n'))
    expect(body).toMatch(/!resolvedLoading\.value/)
    expect(body).toMatch(/!resolvedError\.value/)
    expect(body).toMatch(/!\(resolvedBookings\.value\.length === 0 && !props\.selectedDate\)/)
    expect(body).toMatch(/groupedBookings\.value\.length > 0/)
  })

  // covers: T3
  it('composed pages get no toggle row; the Panel turns it on', () => {
    expect(list.script).toMatch(/listToggles:\s*false/)
    expect(listHits.length).toBeGreaterThan(0)
    for (const hit of listHits) {
      const guards = [hit.node, ...hit.anc].map(n => directive(n, 'if') ?? '')
      expect(guards.some(g => g.startsWith('listToggles'))).toBe(true)
    }
    for (const { node } of find(layoutList.ast, 'CroutonBookingsList')) {
      expect(hasProp(node, 'list-toggles')).toBe(false)
    }
    const panelLists = find(panel.ast, 'CroutonBookingsList')
    expect(panelLists).toHaveLength(1)
    const p = panelLists[0]!.node
    expect(hasProp(p, 'list-toggles')).toBe(true)
    expect(directive(p, 'bind', 'show-cancelled')).toBe('filterState.showCancelled')
    expect(directive(p, 'bind', 'show-map')).toBe('showMap')
    expect(directive(p, 'bind', 'can-show-map')).toBe('hasLocationsWithCoordinates')
    expect(directive(p, 'on', 'update:show-cancelled')).toBe('filterState.showCancelled = $event')
    expect(directive(p, 'on', 'update:show-map')).toBe('showMap = $event')
  })
})
