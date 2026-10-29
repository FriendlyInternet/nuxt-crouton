/**
 * DOM-free HTML sanitiser — identical on server (SSR / Workers) and client.
 * Allow-list based: unknown tags are escaped, unknown attributes dropped,
 * URLs restricted to http(s), mailto, tel and relative.
 */
import { FilterXSS } from 'xss'

const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|#|\?|\.)/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Returns the url when its scheme is safe, otherwise undefined. */
export function safeUrl(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined
  // Browsers ignore control chars/whitespace inside and before the scheme
  // eslint-disable-next-line no-control-regex
  const cleaned = url.replace(/[\u0000-\u0020\u007F-\u009F]/g, '')
  if (!cleaned) return undefined
  if (SAFE_URL.test(cleaned)) return url.trim()
  if (HAS_SCHEME.test(cleaned)) return undefined
  return url.trim()
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const filter = new FilterXSS({
  whiteList: {
    p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [], code: [], pre: [], mark: [],
    a: ['href', 'target', 'rel', 'title'],
    ul: [], ol: [], li: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    blockquote: [], hr: [],
    img: ['src', 'alt', 'title', 'width', 'height'],
    table: [], thead: [], tbody: [], tr: [], th: [], td: [],
    span: [], div: [],
  },
  stripIgnoreTagBody: ['script', 'style'],
  css: false,
  safeAttrValue(tag, name, value, cssFilter) {
    if (name === 'href' || name === 'src') {
      return safeUrl(value) === undefined ? '' : escapeHtml(value.trim()).replace(/&amp;/g, '&')
    }
    if (name === 'target') return value === '_blank' || value === '_self' ? value : ''
    return escapeHtml(value)
  },
  onTagAttr(tag, name, value) {
    // Drop href/src entirely when the url is unsafe
    if ((name === 'href' || name === 'src') && safeUrl(value) === undefined) return ''
    return undefined
  },
  onTag(tag, html, options) {
    if (tag === 'a' && !options.isClosing && /target="_blank"/.test(html) && !/rel=/.test(html)) {
      return html.replace(/>$/, ' rel="noopener noreferrer">')
    }
    return undefined
  },
})

export function sanitizeHtml(html: string): string {
  return filter.process(html || '')
}

/**
 * Convert inline content (text nodes with marks) to sanitised HTML.
 * Shared by paragraph, heading, and list item renderers.
 */
export function inlineContentToHtml(content: any[]): string {
  if (!content || !Array.isArray(content)) return ''

  const html = content.map((node: any) => {
    if (node.type === 'hardBreak') return '<br>'
    if (node.type === 'text') {
      let text = escapeHtml(node.text || '')
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'bold') text = `<strong>${text}</strong>`
          else if (mark.type === 'italic') text = `<em>${text}</em>`
          else if (mark.type === 'underline') text = `<u>${text}</u>`
          else if (mark.type === 'strike') text = `<s>${text}</s>`
          else if (mark.type === 'code') text = `<code>${text}</code>`
          else if (mark.type === 'highlight') text = `<mark>${text}</mark>`
          else if (mark.type === 'link') {
            const href = safeUrl(mark.attrs?.href)
            const target = mark.attrs?.target === '_blank' || mark.attrs?.target === '_self' ? mark.attrs.target : undefined
            const hrefAttr = href ? ` href="${escapeHtml(href)}"` : ''
            const targetAttr = target ? ` target="${target}"` : ''
            text = `<a${hrefAttr}${targetAttr}>${text}</a>`
          }
        }
      }
      return text
    }
    return ''
  }).join('')

  return sanitizeHtml(html)
}
