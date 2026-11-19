// @vitest-environment node
// #4091 — in the tabs layout the page editor (CroutonPagesEditorBlockEditorWithPreview) must fill
// the input's height instead of sitting in a fixed 500px box (it stopped ~220px above the window
// bottom). happy-dom has no layout engine, so these check the real SFC template; the real height
// is measured on the PR preview.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

const file = fileURLToPath(new URL('../Input.vue', import.meta.url))
const source = readFileSync(file, 'utf8')
const { descriptor } = parse(source)
const ast = descriptor.template!.ast!

type Node = { type: number, tag?: string, props?: any[], children?: Node[], loc?: { start: { offset: number } } }

function walk(node: Node, visit: (n: Node, parents: Node[]) => void, parents: Node[] = []) {
  visit(node, parents)
  for (const c of node.children ?? []) walk(c, visit, [...parents, node])
}

function attr(n: Node, name: string): string | undefined {
  return (n.props ?? []).find(p => p.type === 6 && p.name === name)?.value?.content
}

function bind(n: Node, arg: string): string | undefined {
  return (n.props ?? []).find(p => p.type === 7 && p.name === 'bind' && p.arg?.content === arg)?.exp?.content
}

function directive(n: Node, name: string): string | undefined {
  return (n.props ?? []).find(p => p.type === 7 && p.name === name)?.exp?.content
}

// The tabs layout is the last branch of the template; its multi-field list is the `isMultiField`
// div whose child is a `UFormField` v-for (the side-by-side branches use other markup).
function tabsList(): Node {
  let found: Node | undefined
  walk(ast as unknown as Node, (n) => {
    if (n.tag === 'div' && directive(n, 'if') === 'isMultiField'
      && (n.children ?? []).some(c => c.tag === 'UFormField')) found = n
  })
  if (!found) throw new Error('tabs-layout multi-field list not found in Input.vue')
  return found
}

function tabsFormField(): Node {
  const f = (tabsList().children ?? []).find(c => c.tag === 'UFormField')
  if (!f) throw new Error('UFormField not found in tabs list')
  return f
}

function tabsWithPreviewWrapper(): Node {
  const w = (tabsFormField().children ?? []).find(c =>
    c.tag === 'div' && (directive(c, 'else-if') ?? directive(c, 'if') ?? '').includes('CroutonPagesEditorBlockEditorWithPreview'))
  if (!w) throw new Error('CroutonPagesEditorBlockEditorWithPreview wrapper not found in tabs layout')
  return w
}

describe('tabs layout — the page editor fills the input height (#4091)', () => {
  it('T1: the WithPreview wrapper has no fixed 500px box and grows with a 350px floor', () => {
    const cls = attr(tabsWithPreviewWrapper(), 'class') ?? ''
    expect(cls).not.toContain('h-[500px]')
    expect(cls).not.toContain('max-h-[600px]')
    expect(cls.split(/\s+/)).toContain('flex-1')
    expect(cls.split(/\s+/)).toContain('min-h-[350px]')
  })

  it('T2: the multi-field list and the UFormField can grow', () => {
    const listClass = bind(tabsList(), 'class') ?? ''
    expect(listClass).toContain('flex-1')
    expect(listClass).toContain('min-h-0')
    expect(listClass).toContain('space-y-4') // other forms keep today's look

    const ui = bind(tabsFormField(), 'ui') ?? ''
    expect(ui).toContain('FILL_COMPONENT')
    // the fillFieldUi object passed to the field makes root + container flex-1
    const script = descriptor.scriptSetup?.content ?? ''
    const m = script.match(/const fillFieldUi = (\{[^}]*\})/)
    expect(m, 'fillFieldUi defined in <script setup>').toBeTruthy()
    expect(m![1]).toMatch(/root:\s*'[^']*flex-1[^']*'/)
    expect(m![1]).toMatch(/container:\s*'[^']*flex-1[^']*'/)
    expect(ui).toContain('fillFieldUi')
    expect(ui).toContain('undefined') // every other field is unchanged
    expect(script).toMatch(/FILL_COMPONENT = 'CroutonPagesEditorBlockEditorWithPreview'/)
  })
})
