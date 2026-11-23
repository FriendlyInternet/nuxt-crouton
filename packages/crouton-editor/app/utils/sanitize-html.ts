/**
 * DOM-free HTML sanitiser — identical on server (SSR / Workers) and client.
 * Allow-list based: unknown tags are escaped, unknown attributes dropped,
 * URLs restricted to http(s), mailto, tel and relative.
 */
import { FilterXSS } from 'xss'

const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|#|\?)/i

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', sol: '/', num: '#',
  quest: '?', lpar: '(', rpar: ')', period: '.', comma: ',', semi: ';', equals: '=',
  Tab: '\t', NewLine: '\n', nbsp: '\u00a0',
}

const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*));?/g

/** A numeric reference (hex or decimal) as its character; '' when out of range. */
function decodeCodePoint(hex: string | undefined, dec: string | undefined): string {
  const cp = hex ? parseInt(hex, 16) : parseInt(dec as string, 10)
  return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''
}

/** Decode HTML character references the way a browser does in attribute values. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (m, hex, dec, name) =>
    hex || dec ? decodeCodePoint(hex, dec) : (NAMED_ENTITIES[name] ?? m))
}

/** Strict allow-list: returns the url when it is https/http/mailto/tel/relative-root/#/?, else undefined. */
export function safeUrl(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined
  // Browsers ignore control chars/whitespace inside and before the scheme
  // eslint-disable-next-line no-control-regex
  const cleaned = url.replace(/[\u0000-\u0020\u007F-\u009F]/g, '')
  if (!cleaned) return undefined
  return SAFE_URL.test(cleaned) ? url.trim() : undefined
}

/** For URLs taken from HTML attribute values: judge the entity-DECODED value. */
export function safeAttrUrl(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  return safeUrl(decodeEntities(raw))
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_TARGETS = new Set(['_blank', '_self'])

/** `_blank` / `_self` pass; any other link target becomes ''. */
function safeTarget(value: unknown): string {
  return SAFE_TARGETS.has(value as string) ? (value as string) : ''
}

function isUrlAttr(name: string): boolean {
  return name === 'href' || name === 'src'
}

/** The escaped url when it is safe, else ''. */
function cleanUrlAttr(value: string): string {
  const url = safeAttrUrl(value)
  return url === undefined ? '' : escapeHtml(url)
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
  safeAttrValue(_tag, name, value) {
    if (isUrlAttr(name)) return cleanUrlAttr(value)
    if (name === 'target') return safeTarget(value)
    return escapeHtml(value)
  },
  onTagAttr(_tag, name, value) {
    // Drop href/src entirely when the url is unsafe
    return isUrlAttr(name) && safeAttrUrl(value) === undefined ? '' : undefined
  },
})

// Runs on already-filtered output: every attribute is `name="value"` with
// `>` and `"` escaped, so this regex can't be fooled. (An `onTag` hook that
// returns a string skips the attribute allow-list entirely — #3375.)
const BLANK_TARGET = /\starget="_blank"/i
const HAS_REL = /\srel="/i
function addNoopener(clean: string): string {
  return clean.replace(/<a\s[^>]*>/gi, tag =>
    BLANK_TARGET.test(tag) && !HAS_REL.test(tag) ? tag.replace(/>$/, ' rel="noopener noreferrer">') : tag)
}

export function sanitizeHtml(html: string): string {
  return addNoopener(filter.process(html || ''))
}

const MARK_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
  highlight: 'mark',
}

/** ` name="value"` (value escaped), or '' when there is no value. */
function attr(name: string, value: string | undefined): string {
  return value ? ` ${name}="${escapeHtml(value)}"` : ''
}

function linkToHtml(text: string, attrs: any): string {
  const a = attrs ?? {}
  return `<a${attr('href', safeUrl(a.href))}${attr('target', safeTarget(a.target))}>${text}</a>`
}

function applyMark(text: string, mark: any): string {
  if (mark.type === 'link') return linkToHtml(text, mark.attrs)
  const tag = MARK_TAGS[mark.type]
  return tag ? `<${tag}>${text}</${tag}>` : text
}

function textNodeToHtml(node: any): string {
  return (node.marks || []).reduce(applyMark, escapeHtml(node.text || ''))
}

function inlineNodeToHtml(node: any): string {
  if (node.type === 'hardBreak') return '<br>'
  return node.type === 'text' ? textNodeToHtml(node) : ''
}

/**
 * Convert inline content (text nodes with marks) to sanitised HTML.
 * Shared by paragraph, heading, and list item renderers.
 */
export function inlineContentToHtml(content: any[]): string {
  if (!content || !Array.isArray(content)) return ''
  return sanitizeHtml(content.map(inlineNodeToHtml).join(''))
}
