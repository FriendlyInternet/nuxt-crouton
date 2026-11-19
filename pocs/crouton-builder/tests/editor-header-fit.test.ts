// #3765 — at phone width the editor header must never widen the page (an empty strip beside the
// board). It scrolls inside itself, and "Saved" shows once (on the Save button). happy-dom has no
// layout engine, so these check the real SFC template; the real width is checked on the preview.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

const file = fileURLToPath(new URL('../app/pages/builder/[pageId].vue', import.meta.url))
const { descriptor } = parse(readFileSync(file, 'utf8'))
const ast = descriptor.template!.ast!

type Node = { type: number, tag?: string, props?: any[], children?: Node[], content?: string }

function walk(node: Node, visit: (n: Node) => void) {
  visit(node)
  for (const c of node.children ?? []) walk(c, visit)
}

function attr(n: Node, name: string): string | undefined {
  const p = (n.props ?? []).find(p => p.type === 6 && p.name === name)
  return p?.value?.content
}

function ownText(n: Node): string {
  return (n.children ?? []).filter(c => c.type === 2).map(c => c.content ?? '').join('').trim()
}

describe('editor header fit (#3765)', () => {
  it('the header scrolls sideways instead of widening the page', () => {
    const headers: Node[] = []
    walk(ast as Node, (n) => { if (n.type === 1 && n.tag === 'header') headers.push(n) })
    expect(headers).toHaveLength(1)
    const cls = (attr(headers[0]!, 'class') ?? '').split(/\s+/)
    expect(cls).toContain('overflow-x-auto')
  })

  it('"Saved" is shown only by the Save button, never as a second label', () => {
    const extra: Node[] = []
    walk(ast as Node, (n) => {
      if (n.type === 1 && attr(n, 'data-handoff') !== 'board-save' && ownText(n) === 'Saved') extra.push(n)
    })
    expect(extra.map(n => n.tag)).toEqual([])
  })
})
