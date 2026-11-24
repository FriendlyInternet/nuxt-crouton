// @vitest-environment node
/**
 * Server-renders the real Preview.vue (no DOM) and checks what lands in the
 * content area: author HTML, TipTap embeds and variable values are cleaned
 * on the server too (#4419).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useEditorVariables } from '../../app/composables/useEditorVariables'
import Preview from '../../app/components/Preview.vue'

const stub = (tag: string) => ({ render(this: any) { return h(tag, this.$slots.default?.()) } })

async function render(props: Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(Preview, { expandable: false, ...props }) })
  app.component('UModal', stub('div'))
  app.component('UButton', stub('button'))
  app.component('UIcon', stub('i'))
  return renderToString(app)
}

beforeEach(() => vi.stubGlobal('useEditorVariables', useEditorVariables))
afterEach(() => vi.unstubAllGlobals())

describe('Preview (server render)', () => {
  // covers: T1
  it('cleans HTML content on the server', async () => {
    const html = await render({
      content: '<p>Hi</p><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a><script>alert(1)</script>'
    })
    expect(html).toContain('Hi')
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toMatch(/<script/i)
  })

  // covers: T2
  it('renders a TipTap embedBlock as a link, never an iframe', async () => {
    const html = await render({
      content: {
        type: 'doc',
        content: [{ type: 'embedBlock', attrs: { url: 'https://www.youtube.com/embed/x' } }]
      }
    })
    expect(html).toMatch(/<a [^>]*href="https:\/\/www\.youtube\.com\/embed\/x"/)
    expect(html).not.toMatch(/<iframe/i)
  })

  // covers: T2
  it('drops an iframe from HTML content', async () => {
    const html = await render({ content: '<iframe src="javascript:alert(1)"></iframe>' })
    expect(html).not.toMatch(/<iframe/i)
  })

  // covers: T3
  it('escapes variable values', async () => {
    const html = await render({ content: 'Hello {{ name }}', values: { name: '<img src=x onerror=1>' } })
    expect(html).toContain('&lt;img')
    expect(html).not.toMatch(/<img/i)
  })

  // covers: T4
  it('still shows the warning chip for an unknown variable', async () => {
    const html = await render({ content: 'Hello {{ missing }}' })
    expect(html).toMatch(/<span class="[^"]*bg-warning\/20[^"]*"[^>]*>\{\{ missing \}\}<\/span>/)
  })

  // covers: T5
  it('keeps TipTap bold text and images', async () => {
    const html = await render({
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] },
          { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'a' } }
        ]
      }
    })
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toMatch(/<img [^>]*src="https:\/\/example\.com\/a\.png"/)
  })
})
