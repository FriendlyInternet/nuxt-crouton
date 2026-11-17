/**
 * #4087 — the location form edits products per location; the old booking-mode switch,
 * "Available units" and the slot capacity box are gone. Reads the real templates.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const ELEMENT = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

type Node = any

function load(rel: string) {
  const file = resolve(__dirname, rel)
  const source = readFileSync(file, 'utf8')
  const { descriptor } = parse(source, { filename: file })
  return { source, ast: descriptor.template!.ast! }
}

function elements(node: Node, out: Node[] = []): Node[] {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT) continue
    out.push(child)
    elements(child, out)
  }
  return out
}

function attr(node: Node, name: string): string | undefined {
  const p = (node.props ?? []).find((p: Node) => p.type === ATTRIBUTE && p.name === name)
  return p?.value?.content
}

function bound(node: Node, name: string): string | undefined {
  const p = (node.props ?? []).find((p: Node) => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === name)
  return p?.exp?.content
}

describe('location form template (#4087)', () => {
  const form = load('../collections/locations/app/components/_Form.vue')
  const formEls = elements(form.ast)

  it('F7 — no booking-mode switch and no "Available units" field', () => {
    expect(formEls.filter(n => n.tag === 'URadioGroup')).toHaveLength(0)
    const names = formEls.filter(n => n.tag === 'UFormField').map(n => attr(n, 'name'))
    expect(names).not.toContain('inventoryMode')
    expect(names).not.toContain('quantity')
    expect(names).toContain('maxBookingsPerMonth')
    expect(form.source).not.toContain('availableUnits')
  })

  it('F7 — has a products field with a picker and a stock input of at least 1', () => {
    const products = formEls.find(n => n.tag === 'UFormField' && attr(n, 'name') === 'products')
    expect(products).toBeTruthy()
    const inside = elements(products)
    expect(inside.some(n => n.tag === 'USelectMenu')).toBe(true)
    const numbers = inside.filter(n => n.tag === 'UInputNumber')
    expect(numbers.length).toBeGreaterThanOrEqual(2)
    for (const n of numbers) expect(bound(n, 'min')).toBe('1')
  })

  it('F7 — the slot input has no capacity box', () => {
    const slot = load('../collections/locations/app/components/Slot/Input.vue')
    expect(elements(slot.ast).filter(n => n.tag === 'UInputNumber')).toHaveLength(0)
    expect(slot.source).not.toContain('capacity')
  })
})
