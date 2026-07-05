/**
 * Pure capture helpers for the Annotate tool.
 *
 * Kept DOM-pure (no overlay/plugin glue) so they're unit-testable under happy-dom.
 * They turn a clicked element + comment into the structured `Annotation` payload
 * the `/api/_feedback` endpoint dispatches to the configured sink.
 *
 * Extracted from @fyit/crouton-devtools (epic #960) with neutral naming.
 */

import { type EnvProfile, formatEnv } from './envProfile'

export interface AnnotationBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Annotation {
  /** Page the comment was left on (location.pathname). */
  route: string
  /** A reasonably-unique CSS selector for the clicked element. */
  cssSelector: string
  /** Owning source file from the nearest `data-feedback-src` ancestor, if any. */
  componentFile: string | null
  /** Viewport-relative bounds of the clicked element. */
  boundingBox: AnnotationBox
  /** What the reviewer typed. */
  commentText: string
  /** The environment it was reported from (#1181) — device/browser/size/touch. */
  env: EnvProfile | null
  /** ISO timestamp. */
  createdAt: string
}

/** Build-time source-stamp attribute (see transform/sourceStamp.ts). */
export const SOURCE_ATTR = 'data-feedback-src'

/**
 * Walk up the DOM to the nearest `data-feedback-src` (stamped at build time by
 * the source-stamp transform) so a click resolves to the source file an agent
 * should edit.
 */
export function componentFileFor(el: Element | null): string | null {
  let node: Element | null = el
  while (node) {
    const src = node.getAttribute?.(SOURCE_ATTR)
    if (src) return src
    node = node.parentElement
  }
  return null
}

/** Build a short, reasonably-unique selector path for an element. */
export function cssSelectorFor(el: Element): string {
  if (el.id) return `#${el.id}`

  const parts: string[] = []
  let node: Element | null = el
  while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
    if (node.id) {
      parts.unshift(`#${node.id}`)
      break
    }
    let part = node.tagName.toLowerCase()
    const parent: Element | null = node.parentElement
    if (parent) {
      const current = node
      const sameTag = Array.from(parent.children).filter(c => c.tagName === current.tagName)
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`
    }
    parts.unshift(part)
    if (parts.length >= 6) break
    node = parent
  }
  return parts.join(' > ')
}

/** Viewport-relative bounds, rounded to whole pixels. */
export function boundingBoxFor(el: Element): AnnotationBox {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height)
  }
}

/**
 * Render an annotation into agent-readable Markdown. Pure (no DOM) so it's shared
 * by the server dispatcher and unit-tested directly. The `🎯 Preview feedback`
 * header + `Component:` line are the contract a subscribed agent keys off to find
 * the file to edit.
 */
export function formatAnnotationMarkdown(a: Annotation): string {
  const b = a.boundingBox
  return [
    '🎯 **Preview feedback**',
    '',
    `- **Component:** ${a.componentFile ? `\`${a.componentFile}\`` : '_unknown_'}`,
    `- **Element:** \`${a.cssSelector}\`${b ? ` _(bbox ${b.x},${b.y} ${b.width}×${b.height})_` : ''}`,
    `- **Page:** \`${a.route}\``,
    ...(a.env ? [`- **Env:** ${formatEnv(a.env)}`] : []),
    '',
    `> ${a.commentText.replace(/\n/g, '\n> ')}`
  ].join('\n')
}

/** Assemble the full annotation payload from a clicked element. */
export function buildAnnotation(el: Element, commentText: string, route: string, env: EnvProfile | null = null): Annotation {
  return {
    route,
    cssSelector: cssSelectorFor(el),
    componentFile: componentFileFor(el),
    boundingBox: boundingBoxFor(el),
    commentText,
    env,
    createdAt: new Date().toISOString()
  }
}
