/**
 * #4172 — the booking list no longer reads the old inventory fields. BookingCard
 * shows the amount as `×N` next to the slot label (no `N / total` from the
 * location quantity); LocationCard's badge counts time slots only. Reads the
 * real .vue files (same style as booking-create-card-template.test.ts).
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
  const location = load('LocationCard.vue')

  // covers: T4
  it('neither BookingCard.vue nor LocationCard.vue reads inventoryMode or the location quantity', () => {
    for (const f of [card, location]) {
      expect(f.source).not.toMatch(/inventoryMode|isInventoryMode/)
      expect(f.source).not.toMatch(/locationData\?\.quantity|location\.quantity/)
    }
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

  // covers: T4
  it('LocationCard.vue shows its badge only for a location with slots, and shows the slot count', () => {
    const badges: Node[] = []
    walk(location.ast, (n) => { if (n.type === ELEMENT && n.tag === 'UBadge') badges.push(n) })
    expect(badges).toHaveLength(1)
    expect(vIf(badges[0]!)).toBe('slotCount > 0')
    expect(textOf(badges[0]!).trim()).toBe('{{slotCount}}')
  })
})
