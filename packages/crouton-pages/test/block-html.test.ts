// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { blockToHtml, listToHtml } from '../app/utils/block-html'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('block-html public renderers (#4437)', () => {
  // covers: T1
  it('renders a blockquote holding a paragraph or a list', () => {
    expect(blockToHtml({ type: 'blockquote', content: [p('text')] }))
      .toBe('<blockquote><p>text</p></blockquote>')
    expect(blockToHtml({
      type: 'blockquote',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('one')] }] }]
    })).toBe('<blockquote><ul><li>one</li></ul></blockquote>')
  })

  // covers: T2
  it('escapes script text inside a quote', () => {
    const html = blockToHtml({ type: 'blockquote', content: [p('<script>alert(1)</script>')] })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/<script/i)
  })

  // covers: T3
  it('renders a codeBlock escaped with newlines kept, and a horizontalRule as <hr>', () => {
    expect(blockToHtml({
      type: 'codeBlock',
      attrs: { language: 'js' },
      content: [{ type: 'text', text: 'a < b\nc' }]
    })).toBe('<pre><code>a &lt; b\nc</code></pre>')
    expect(blockToHtml({ type: 'horizontalRule' })).toBe('<hr>')
  })

  // covers: T4
  it('listToHtml keeps its nested-list output after the move', () => {
    expect(listToHtml({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          p('a'),
          { type: 'orderedList', content: [{ type: 'listItem', content: [p('b')] }] }
        ]
      }]
    })).toBe('<ul><li>a<ol><li>b</li></ol></li></ul>')
  })

  it('returns an empty string for a type it does not render', () => {
    expect(blockToHtml({ type: 'mysteryBlock' })).toBe('')
  })
})
