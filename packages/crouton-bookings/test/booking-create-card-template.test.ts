/**
 * #4112 — the booking card: locations as one sideways-scrolling UTabs row, product
 * buttons via showProductPicker, slots with the number free, an amount box at every
 * location, and an edit that sends product + quantity. Reads the real
 * BookingCreateCard.vue and checks that shape (same style as calendar-single-popover.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const file = resolve(__dirname, '../app/components/BookingCreateCard.vue')
const source = readFileSync(file, 'utf8')
const { descriptor } = parse(source, { filename: file })
const ast = descriptor.template!.ast!
const script = descriptor.scriptSetup!.content
const template = descriptor.template!.content

const ELEMENT = 1
const DIRECTIVE = 7

type Node = any

function walk(node: Node, ancestors: Node[], visit: (n: Node, anc: Node[]) => void) {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT) continue
    visit(child, ancestors)
    walk(child, [...ancestors, child], visit)
  }
}

function find(tag: string): { node: Node, anc: Node[] }[] {
  const hits: { node: Node, anc: Node[] }[] = []
  walk(ast, [], (n, anc) => { if (n.tag === tag) hits.push({ node: n, anc }) })
  return hits
}

function bound(node: Node, arg: string): string | undefined {
  const p = (node.props ?? []).find((p: Node) => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === arg)
  return p?.exp?.content
}

describe('BookingCreateCard.vue (#4112)', () => {
  // covers: T3
  it('locations are a UTabs row that scrolls sideways and never squeezes a tab', () => {
    const tabs = find('UTabs')
    expect(tabs).toHaveLength(1)
    const ui = bound(tabs[0]!.node, 'ui') ?? ''
    expect(ui).toContain('overflow-x-auto')
    expect(ui).toContain('min-w-fit')
    expect(template).not.toContain('w-52')
  })

  // covers: T3
  it('uses Nuxt UI only: no raw <button> or <input>', () => {
    expect(find('button')).toHaveLength(0)
    expect(find('input')).toHaveLength(0)
  })

  // covers: T3
  it('the amount box is not hidden behind !hasSlots', () => {
    const inputs = find('UInputNumber')
    expect(inputs).toHaveLength(1)
    const conds = inputs[0]!.anc.flatMap((a: Node) => (a.props ?? [])
      .filter((p: Node) => p.type === DIRECTIVE && (p.name === 'if' || p.name === 'else-if' || p.name === 'show'))
      .map((p: Node) => p.exp?.content ?? ''))
    expect(conds.some((c: string) => c.includes('!hasSlots'))).toBe(false)
  })

  // covers: T3
  it('no "left" / "of N available" text on screen', () => {
    expect(source).not.toContain('createCard.left')
    expect(source).not.toContain('ofAvailable')
  })

  // covers: T3
  it('shows product buttons through showProductPicker and saves an edit with editBookingBody', () => {
    expect(script).toContain('showProductPicker(')
    expect(script).toContain('editBookingBody(')
  })
})
