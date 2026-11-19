// @vitest-environment node
/**
 * #3982 T1 — the shared TipTap ⇄ Yjs converter keeps attributes and marks,
 * edits blocks at an index, and seeds deterministically.
 */
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  tiptapToYFragment,
  yFragmentToTiptap,
  editYFragment,
  seedYFragment,
  hasFragmentContent,
  seedClientId
} from '../shared/tiptap-yjs'

const layout = {
  renderer: 'panes',
  root: { type: 'split', direction: 'horizontal', children: [
    { type: 'leaf', blockId: 'calendar' },
    { type: 'leaf', blockId: 'bookings-list' }
  ] }
}

function fragmentOf(doc: unknown, name = 'content-fr') {
  const ydoc = new Y.Doc()
  const fragment = ydoc.getXmlFragment(name)
  tiptapToYFragment(doc, fragment)
  return { ydoc, fragment }
}

const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })

// covers: T1
describe('tiptapToYFragment / yFragmentToTiptap', () => {
  it('keeps object and number attributes raw (a layout block survives)', () => {
    const page = { type: 'doc', content: [
      { type: 'paneBlock', attrs: { layout, height: 480 } },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hi' }] }
    ] }
    const { fragment } = fragmentOf(page)
    const back = yFragmentToTiptap(fragment)
    expect(back.content[0]).toEqual({ type: 'paneBlock', attrs: { layout, height: 480 } })
    expect(back.content[1]).toEqual({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hi' }] })
    expect(JSON.stringify(back)).not.toContain('[object Object]')
  })

  it('keeps marks, merging a paragraph\'s text into one Y.XmlText', () => {
    const page = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Hi ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] }
    ] }] }
    const { fragment } = fragmentOf(page)
    const paragraph = fragment.get(0) as Y.XmlElement
    expect(paragraph.length).toBe(1)
    const text = paragraph.get(0) as Y.XmlText
    expect(text.toDelta()).toEqual([
      { insert: 'Hi ' },
      { insert: 'bold', attributes: { bold: {} } },
      { insert: ' link', attributes: { link: { href: 'https://x.test' } } }
    ])
    expect(yFragmentToTiptap(fragment)).toEqual(page)
  })

  it('keeps an inline element (hardBreak) between text runs', () => {
    const page = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }
    ] }] }
    const { fragment } = fragmentOf(page)
    expect((fragment.get(0) as Y.XmlElement).length).toBe(3)
    expect(yFragmentToTiptap(fragment)).toEqual(page)
  })
})

// covers: T1
describe('editYFragment', () => {
  const base = () => fragmentOf({ type: 'doc', content: [heading('A'), heading('B'), heading('C')] })
  const titles = (f: Y.XmlFragment) => yFragmentToTiptap(f).content.map(n => n.content?.[0]?.text)

  it('inserts before an index, and appends at index === length', () => {
    const { fragment } = base()
    editYFragment(fragment, { action: 'insert', index: 1, blocks: [heading('X')] })
    expect(titles(fragment)).toEqual(['A', 'X', 'B', 'C'])
    editYFragment(fragment, { action: 'insert', index: 4, blocks: [heading('Z')] })
    expect(titles(fragment)).toEqual(['A', 'X', 'B', 'C', 'Z'])
  })

  it('replaces count (default blocks.length) blocks at an index', () => {
    const { fragment } = base()
    editYFragment(fragment, { action: 'replace', index: 1, blocks: [heading('X')] })
    expect(titles(fragment)).toEqual(['A', 'X', 'C'])
    editYFragment(fragment, { action: 'replace', index: 0, count: 2, blocks: [heading('Y')] })
    expect(titles(fragment)).toEqual(['Y', 'C'])
  })

  it('deletes count (default 1) blocks at an index', () => {
    const { fragment } = base()
    editYFragment(fragment, { action: 'delete', index: 0 })
    expect(titles(fragment)).toEqual(['B', 'C'])
    editYFragment(fragment, { action: 'delete', index: 0, count: 2 })
    expect(titles(fragment)).toEqual([])
  })

  it('throws RangeError for an out-of-range index', () => {
    const { fragment } = base()
    expect(() => editYFragment(fragment, { action: 'insert', index: 4, blocks: [heading('X')] })).toThrow(RangeError)
    expect(() => editYFragment(fragment, { action: 'replace', index: 3, blocks: [heading('X')] })).toThrow(RangeError)
    expect(() => editYFragment(fragment, { action: 'delete', index: -1 })).toThrow(RangeError)
    expect(() => editYFragment(fragment, { action: 'delete', index: 2, count: 2 })).toThrow(RangeError)
    expect(titles(fragment)).toEqual(['A', 'B', 'C'])
  })
})

// covers: T1
describe('seedYFragment', () => {
  const page = { type: 'doc', content: [heading('Welcome'), { type: 'paneBlock', attrs: { layout, height: 480 } }] }

  it('two docs seeded with the same content, merged, hold one copy', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    seedYFragment(a, 'content-fr', page)
    seedYFragment(b, 'content-fr', page)
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(yFragmentToTiptap(a.getXmlFragment('content-fr')).content).toHaveLength(2)
    expect(yFragmentToTiptap(a.getXmlFragment('content-fr'))).toEqual(yFragmentToTiptap(b.getXmlFragment('content-fr')))
    expect(yFragmentToTiptap(a.getXmlFragment('content-fr'))).toEqual(page)
  })

  it('seedClientId is stable and never 0', () => {
    expect(seedClientId('x')).toBe(seedClientId('x'))
    expect(seedClientId('x')).not.toBe(seedClientId('y'))
    expect(seedClientId('')).toBeGreaterThan(0)
  })

  it('hasFragmentContent treats empty and a lone empty paragraph as empty', () => {
    expect(hasFragmentContent(fragmentOf({ type: 'doc', content: [] }).fragment)).toBe(false)
    expect(hasFragmentContent(fragmentOf({ type: 'doc', content: [{ type: 'paragraph' }] }).fragment)).toBe(false)
    expect(hasFragmentContent(fragmentOf({ type: 'doc', content: [heading('A')] }).fragment)).toBe(true)
  })
})
