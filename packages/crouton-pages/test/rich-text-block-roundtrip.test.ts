/**
 * Rule (#4436): opening a page in the block editor and saving it without
 * changes must never remove or alter a `richTextBlock` or its `content`.
 *
 * Built against the editor's REAL schema (`PageBlocks`, global attributes
 * included) — the `.vue` node views are stubbed by vitest.config.ts. Before the
 * fix `nodeFromJSON` threw "Unknown node type: richTextBlock" and TipTap fell
 * back to an empty document (the blank page).
 */
import { describe, it, expect } from 'vitest'
import { getSchema, Node } from '@tiptap/core'
import { PageBlocks } from '../app/editor/extensions/page-blocks'

// Minimal doc/paragraph/text nodes, so the test needs no extra @tiptap packages
const Document = Node.create({ name: 'doc', topNode: true, content: 'block+' })
const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: () => ['p', 0]
})
const Text = Node.create({ name: 'text', group: 'inline' })

const schema = getSchema([
  Document,
  Paragraph,
  Text,
  PageBlocks.configure({ enableSlashCommands: false })
])

const roundTrip = (doc: Record<string, unknown>) => schema.nodeFromJSON(doc).toJSON()

// Copied from seed/index.ts (crouton-pages demo "Welkom" page)
const WELCOME_CONTENT
  = '<h1>Welkom</h1><p>Dit is een demo-pagina, aangemaakt door <code>pnpm db:seed</code>.</p>'

describe('richTextBlock survives an editor load → save (#4436)', () => {
  it('keeps the seeded Welkom block with identical content, adding only no-op defaults', () => {
    const out = roundTrip({
      type: 'doc',
      content: [{ type: 'richTextBlock', attrs: { content: WELCOME_CONTENT } }]
    })

    expect(out.content).toHaveLength(1)
    const block = out.content[0]
    expect(block.type).toBe('richTextBlock')
    expect(block.attrs.content).toBe(WELCOME_CONTENT)
    expect(block.attrs).toEqual({
      content: WELCOME_CONTENT,
      blockId: null,
      blockSize: 'default',
      blockVisibility: null
    })
  })

  it('keeps every stored attribute unchanged', () => {
    const attrs = {
      blockId: 'block-x',
      blockSize: 'wide',
      blockVisibility: { audience: 'members' },
      content: '<p>Hallo <strong>wereld</strong></p>'
    }
    const doc = { type: 'doc', content: [{ type: 'richTextBlock', attrs }] }

    expect(roundTrip(doc)).toEqual(doc)
  })

  it('keeps surrounding paragraphs and order', () => {
    const out = roundTrip({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'richTextBlock', attrs: { content: WELCOME_CONTENT } },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }
      ]
    })

    expect(out.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'richTextBlock', 'paragraph'])
    expect(out.content[0].content[0].text).toBe('before')
    expect(out.content[1].attrs.content).toBe(WELCOME_CONTENT)
    expect(out.content[2].content[0].text).toBe('after')
  })
})
