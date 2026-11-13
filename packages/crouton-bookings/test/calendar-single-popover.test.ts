/**
 * #3895 — the calendar used to mount one UPopover per location per day (126 on a month
 * page), which made the page jump on phones (#3813). It now has ONE shared hover card
 * next to the views. This reads the real Calendar.vue template and checks that shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const file = resolve(__dirname, '../app/components/Calendar.vue')
const source = readFileSync(file, 'utf8')
const { descriptor } = parse(source, { filename: file })
const ast = descriptor.template!.ast!

const OVERLAY = /^(UPopover|UTooltip|UModal|USlideover|UDrawer|UDropdownMenu|UContextMenu)$/
const ELEMENT = 1
const DIRECTIVE = 7
const ATTRIBUTE = 6

type Node = any

function hasDir(node: Node, name: string): boolean {
  return (node.props ?? []).some((p: Node) => p.type === DIRECTIVE && p.name === name)
}

function walk(node: Node, ancestors: Node[], visit: (n: Node, anc: Node[]) => void) {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT) continue
    visit(child, ancestors)
    walk(child, [...ancestors, child], visit)
  }
}

describe('Calendar.vue — one shared hover card (#3895)', () => {
  it('no overlay sits inside a v-for or a slot template', () => {
    const hits: number[] = []
    walk(ast, [], (n, anc) => {
      if (!OVERLAY.test(n.tag)) return
      const repeated = hasDir(n, 'for') || anc.some(a => hasDir(a, 'for'))
      const inSlot = anc.some(a => a.tag === 'template' && hasDir(a, 'slot'))
      if (repeated || inSlot) hits.push(n.loc.start.line)
    })
    expect(hits).toEqual([])
  })

  it('has exactly one UPopover, a direct child of the root, hover mode with a bound reference', () => {
    const roots = (ast.children as Node[]).filter(c => c.type === ELEMENT)
    expect(roots).toHaveLength(1)
    const root = roots[0]
    const popovers: { node: Node, parent: Node }[] = []
    walk(ast, [], (n, anc) => {
      if (n.tag === 'UPopover') popovers.push({ node: n, parent: anc[anc.length - 1] })
    })
    expect(popovers).toHaveLength(1)
    const { node, parent } = popovers[0]!
    expect(parent).toBe(root)
    const mode = node.props.find((p: Node) => p.type === ATTRIBUTE && p.name === 'mode')
    expect(mode?.value?.content).toBe('hover')
    const reference = node.props.find((p: Node) =>
      p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === 'reference')
    expect(reference).toBeTruthy()
  })

  it('writes the location card once', () => {
    const template = descriptor.template!.content
    const count = template.split('bookings.calendar.units').length - 1
    expect(count).toBe(1)
  })
})
