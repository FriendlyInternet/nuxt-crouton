/**
 * #4172 — the booking list no longer reads the old inventory fields. BookingCard
 * shows the amount as `×N` next to the slot label (no `N / total` from the
 * location quantity). (LocationCard.vue was removed in #4471 — locations are a
 * tab row now.) Reads the real .vue files (same style as booking-create-card-template.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const ELEMENT = 1
const TEXT = 2
const INTERPOLATION = 5
const DIRECTIVE = 7

type Node = any

function load(name: string) {
  const file = resolve(__dirname, `../app/components/${name}`)
  const source = readFileSync(file, 'utf8')
  const { descriptor, errors } = parse(source, { filename: file })
  expect(errors).toEqual([])
  return { source, ast: descriptor.template!.ast!, script: descriptor.scriptSetup!.content }
}

function walk(node: Node, visit: (n: Node) => void) {
  for (const child of node.children ?? []) {
    visit(child)
    if (child.type === ELEMENT) walk(child, visit)
  }
}

/** The text of an element: its literal text and the expressions it interpolates */
function textOf(node: Node): string {
  return (node.children ?? []).map((c: Node) =>
    c.type === TEXT ? c.content : c.type === INTERPOLATION ? `{{${c.content.content}}}` : '',
  ).join('')
}

function vIf(node: Node): string | undefined {
  const p = (node.props ?? []).find((p: Node) => p.type === DIRECTIVE && p.name === 'if')
  return p?.exp?.content
}

describe('booking list cards drop the old inventory fields (#4172)', () => {
  const card = load('BookingCard.vue')

  // covers: T4
  it('BookingCard.vue does not read inventoryMode or the location quantity', () => {
    expect(card.source).not.toMatch(/inventoryMode|isInventoryMode/)
    expect(card.source).not.toMatch(/locationData\?\.quantity|location\.quantity/)
  })

  // covers: T4
  it('BookingCard.vue renders ×quantity, only when more than one, with no / total', () => {
    const hits: Node[] = []
    walk(card.ast, (n) => { if (n.type === ELEMENT && textOf(n).includes('×')) hits.push(n) })
    expect(hits).toHaveLength(1)
    const span = hits[0]!
    expect(textOf(span).trim()).toBe('×{{booking.quantity}}')
    expect(vIf(span)?.replace(/\s/g, '')).toBe('(booking.quantity??1)>1')
    expect(textOf(span)).not.toContain('/')
  })
})

const ATTRIBUTE = 6

/** A static attribute (type 6) or a v-bind (type 7) with this name */
function propOf(node: Node, name: string): Node | undefined {
  return (node.props ?? []).find((p: Node) =>
    (p.type === ATTRIBUTE && p.name === name)
    || (p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === name),
  )
}

/** Any non-empty text or interpolation among descendants, not counting what sits inside UIcon */
function hasVisibleText(node: Node): boolean {
  for (const c of node.children ?? []) {
    if (c.type === TEXT && c.content.trim()) return true
    if (c.type === INTERPOLATION) return true
    if (c.type === ELEMENT && c.tag !== 'UIcon' && hasVisibleText(c)) return true
  }
  return false
}

function bindExp(node: Node, name: string): string | undefined {
  const p = (node.props ?? []).find((p: Node) =>
    p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === name)
  return p?.exp?.content?.replace(/\s/g, '')
}

/** Every element in the template, depth-first */
function elements(ast: Node): Node[] {
  const out: Node[] = []
  walk(ast, (n) => { if (n.type === ELEMENT) out.push(n) })
  return out
}

const where = (n: Node) => `${n.tag}:${n.loc.start.line}`

function isButton(n: Node): boolean {
  return n.tag === 'UButton' || n.tag === 'button'
}

function hasName(n: Node): boolean {
  return Boolean(propOf(n, 'label') || propOf(n, 'aria-label')) || hasVisibleText(n)
}

function staticClass(n: Node): string {
  const cls = (n.props ?? []).find((p: Node) => p.type === ATTRIBUTE && p.name === 'class')
  return cls?.value?.content ?? ''
}

function isFakeClickable(n: Node): boolean {
  return ['span', 'div'].includes(n.tag) && staticClass(n).includes('cursor-pointer')
}

function clickExp(n: Node): string {
  const click = (n.props ?? []).find((p: Node) => p.type === DIRECTIVE && p.name === 'on' && p.arg?.content === 'click')
  return click?.exp?.content?.replace(/\s/g, '') ?? ''
}

describe('booking card accessibility (#4344)', () => {
  const card = load('BookingCard.vue')
  const all = elements(card.ast)

  // covers: T1
  it('every button has an accessible name and no span/div pretends to be clickable', () => {
    expect(all.filter(n => isButton(n) && !hasName(n)).map(where)).toEqual([])
    expect(all.filter(isFakeClickable).map(where)).toEqual([])
  })

  // covers: T2
  it('the three new keys exist in en/nl/fr and emailStatus is still an object', () => {
    for (const locale of ['en', 'nl', 'fr']) {
      const json = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${locale}.json`), 'utf8'))
      const cardKeys = json.bookings.card
      for (const key of ['editBooking', 'showDayInCalendar', 'emailPanel']) {
        expect(typeof cardKeys[key], `${locale}: bookings.card.${key}`).toBe('string')
        expect(cardKeys[key].trim()).not.toBe('')
      }
      expect(cardKeys.showDayInCalendar).toContain('{date}')
      expect(typeof cardKeys.emailStatus).toBe('object')
      expect(Object.keys(cardKeys.emailStatus).length).toBeGreaterThan(0)
    }
  })

  // covers: T3
  it('both collapsible panels are inert while closed and both toggles bind aria-expanded', () => {
    for (const state of ['isEmailPanelOpen', 'isTimelineOpen']) {
      const panels = all.filter(n => n.tag === 'div' && (bindExp(n, 'class') ?? '').startsWith(`${state}?`))
      const toggles = all.filter(n => n.tag === 'UButton' && clickExp(n) === `${state}=!${state}`)
      expect(panels, state).toHaveLength(1)
      expect(bindExp(panels[0]!, 'inert')).toBe(`!${state}`)
      expect(toggles, state).toHaveLength(1)
      expect(bindExp(toggles[0]!, 'aria-expanded')).toBe(state)
    }
  })
})
