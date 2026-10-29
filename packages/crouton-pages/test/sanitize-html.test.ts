// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sanitizeHtml, safeUrl, inlineContentToHtml } from '../app/utils/sanitize-html'

describe('sanitizeHtml (server path, no DOM)', () => {
  it('runs without window', () => {
    expect(typeof window).toBe('undefined')
  })

  it('removes onerror handlers', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).not.toMatch(/onerror/i)
  })

  it('strips unsafe hrefs', () => {
    for (const h of ['javascript:alert(1)', 'JaVa\tScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      const out = sanitizeHtml(`<a href="${h}">x</a>`)
      expect(out).not.toMatch(/href/i)
    }
  })

  it('does not produce a live iframe', () => {
    expect(sanitizeHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>')).not.toMatch(/<iframe/i)
  })

  it('removes script/object/embed/form and script bodies', () => {
    const out = sanitizeHtml('<script>alert(1)</script><object data=x></object><embed src=x><form action=x></form>')
    expect(out).not.toMatch(/<(script|object|embed|form)/i)
    expect(out).not.toContain('alert(1)')
  })

  it('removes style attributes', () => {
    expect(sanitizeHtml('<p style="background:url(javascript:alert(1))">x</p>')).not.toMatch(/style/i)
  })

  it('keeps normal TipTap output', () => {
    const html = '<p><strong>a</strong> <em>b</em> <a href="https://a.b/c?x=1&y=2">l</a></p><ul><li>i</li></ul><img src="/x.png">'
    const out = sanitizeHtml(html)
    expect(out).toContain('<strong>a</strong>')
    expect(out).toContain('href="https://a.b/c?x=1&y=2"')
    expect(out).toContain('<li>i</li>')
    expect(out).toContain('src="/x.png"')
  })

  it('keeps relative, mailto and tel hrefs; adds rel for _blank', () => {
    const out = sanitizeHtml('<a href="/p">a</a><a href="mailto:a@b.c">b</a><a href="tel:123">c</a><a href="https://x.y" target="_blank">d</a>')
    expect(out).toContain('href="/p"')
    expect(out).toContain('href="mailto:a@b.c"')
    expect(out).toContain('href="tel:123"')
    expect(out).toContain('rel="noopener noreferrer"')
  })
})

describe('safeUrl', () => {
  it.each([
    ['https://a.b', 'https://a.b'],
    ['/path', '/path'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['javascript:alert(1)', undefined],
    ['  javascript:alert(1)', undefined],
    ['data:text/html,x', undefined],
    ['vbscript:x', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%s', (input, expected) => {
    expect(safeUrl(input as any)).toBe(expected)
  })
})

describe('inlineContentToHtml', () => {
  it('escapes text nodes', () => {
    const out = inlineContentToHtml([{ type: 'text', text: '<img src=x onerror=1>' }])
    expect(out).not.toContain('<img')
  })

  it('drops javascript: link href', () => {
    const out = inlineContentToHtml([{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }])
    expect(out).not.toMatch(/href/i)
  })

  it('renders bold + link marks', () => {
    const out = inlineContentToHtml([{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://a.b' } }] }])
    expect(out).toContain('<strong>x</strong>')
    expect(out).toContain('href="https://a.b"')
  })
})
