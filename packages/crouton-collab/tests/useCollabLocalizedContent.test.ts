import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'

// Each useCollabConnection() call gets its own Y.Doc — one per simulated
// browser window. No WebSocket: the test relays updates between docs by hand,
// the way the collab server relays them.
vi.mock('../app/composables/useCollabConnection', async () => {
  const { computed } = await import('vue')
  const Yjs = await import('yjs')
  return {
    useCollabConnection: () => {
      const ydoc = new Yjs.Doc()
      return {
        ydoc,
        connected: computed(() => true),
        synced: computed(() => true),
        error: computed(() => null),
        connect: () => {},
        disconnect: () => {},
        onAwareness: () => {}
      }
    }
  }
})

const { useCollabLocalizedContent } = await import('../app/composables/useCollabLocalizedContent')

/** The 7-block page from #3983. */
const page = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Intro text' }] },
    { type: 'imageTextBlock', attrs: { image: '/a.jpg', layout: 'left' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Third paragraph' }] },
    { type: 'heroBlock', attrs: { title: 'Hero' } }
  ]
}

function blockCount(c: ReturnType<typeof useCollabLocalizedContent>, locale = 'en') {
  return (c.getContentJson(locale) as { content: unknown[] }).content.length
}

function exchange(a: Y.Doc, b: Y.Doc) {
  const ua = Y.encodeStateAsUpdate(a)
  const ub = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(b, ua, 'remote')
  Y.applyUpdate(a, ub, 'remote')
}

describe('useCollabLocalizedContent.setContentJson (#3983)', () => {
  it('T1: two windows filling an empty room at once with the same page end with one copy', () => {
    const a = useCollabLocalizedContent({ roomId: 'page-1' })
    const b = useCollabLocalizedContent({ roomId: 'page-1' })

    // Both see an empty room and fill it before seeing each other's fill.
    a.setContentJson('en', page)
    b.setContentJson('en', page)
    expect(blockCount(a)).toBe(7)
    expect(blockCount(b)).toBe(7)

    exchange(a.ydoc, b.ydoc)

    expect(blockCount(a)).toBe(7)
    expect(blockCount(b)).toBe(7)
    expect(a.getContentJson('en')).toEqual(b.getContentJson('en'))
  })

  it('does not refill a room that already has content', () => {
    const a = useCollabLocalizedContent({ roomId: 'page-2' })
    a.setContentJson('en', page)
    a.setContentJson('en', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'other' }] }] })
    expect(blockCount(a)).toBe(7)
  })

  it('different content from two windows keeps both docs in agreement', () => {
    const a = useCollabLocalizedContent({ roomId: 'page-3' })
    const b = useCollabLocalizedContent({ roomId: 'page-3' })
    const older = { type: 'doc', content: page.content.slice(0, 3) }
    a.setContentJson('en', page)
    b.setContentJson('en', older)
    exchange(a.ydoc, b.ydoc)
    expect(a.getContentJson('en')).toEqual(b.getContentJson('en'))
  })

  it('force=true still replaces existing content', () => {
    const a = useCollabLocalizedContent({ roomId: 'page-4' })
    a.setContentJson('en', page)
    a.setContentJson('en', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'translated' }] }] }, true)
    expect(blockCount(a)).toBe(1)
  })

  it('emits the seed as a non-remote update so it is sent to the server', () => {
    const a = useCollabLocalizedContent({ roomId: 'page-5' })
    const origins: unknown[] = []
    a.ydoc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    a.setContentJson('en', page)
    expect(origins.length).toBeGreaterThan(0)
    expect(origins).not.toContain('remote')
  })
})
