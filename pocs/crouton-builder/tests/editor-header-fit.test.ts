import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'vue/compiler-sfc'

// #3765 — after Save on a phone, the editor header grew wider than the screen and
// widened the whole page, leaving an empty strip beside the (screen-wide) board.
//
// This suite runs in node (happy-dom has no layout engine), so it cannot measure
// "page width === board width". It pins the two rules that keep the header from
// widening the page, read from the REAL page SFC template. The width itself is
// checked live on the preview: at 390px and 402px, change something, Save, then
// document.documentElement.scrollWidth === innerWidth === [data-handoff=board] width.

const file = fileURLToPath(new URL('../app/pages/builder/[pageId].vue', import.meta.url))
const { descriptor } = parse(readFileSync(file, 'utf8'))

// Minimal shape of the compiler's template AST nodes we walk.
interface Node {
  type: number
  tag?: string
  content?: string
  props?: { type: number, name: string, value?: { content: string } }[]
  children?: Node[]
}
const ELEMENT = 1
const TEXT = 2
const ATTRIBUTE = 6

function walk(node: Node, visit: (n: Node) => void) {
  visit(node)
  for (const c of node.children ?? []) walk(c, visit)
}
const attr = (n: Node, name: string) =>
  n.props?.find(p => p.type === ATTRIBUTE && p.name === name)?.value?.content

const root = descriptor.template!.ast as unknown as Node

describe('editor header fit (#3765)', () => {
  it('the editor header never widens the page', () => {
    const headers: Node[] = []
    walk(root, n => { if (n.type === ELEMENT && n.tag === 'header') headers.push(n) })
    expect(headers).toHaveLength(1)
    const classes = (attr(headers[0]!, 'class') ?? '').split(/\s+/)
    expect(classes).toContain('overflow-x-auto')
  })

  it('saved state is shown once', () => {
    const offenders: string[] = []
    walk(root, (n) => {
      if (n.type !== ELEMENT) return
      if (attr(n, 'data-handoff') === 'board-save') return
      if (n.children?.some(c => c.type === TEXT && c.content?.trim() === 'Saved')) offenders.push(n.tag!)
    })
    expect(offenders).toEqual([])
  })
})
