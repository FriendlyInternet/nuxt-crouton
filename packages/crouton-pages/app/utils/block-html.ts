/**
 * Public HTML renderers for native TipTap block nodes that have no dedicated
 * template branch in BlockContent.vue (#4437).
 *
 * Every block kind the page editor's toolbar can insert (`blockTypesGroup` in
 * crouton-editor's toolbarPresets.ts) must have a public renderer — either a
 * template branch (heading, paragraph) or an entry in `blockHtmlRenderers`.
 * `test/editor-toolbar-coverage.test.ts` enforces that rule against the real
 * toolbar list. All output goes through crouton-pages' DOM-free `sanitizeHtml`.
 */
import { sanitizeHtml, inlineContentToHtml, escapeHtml } from './sanitize-html'

type TipTapNode = { type?: string, text?: string, content?: TipTapNode[], attrs?: Record<string, unknown> }

/**
 * Convert a list block (bulletList/orderedList) to HTML.
 * Handles nested listItem > paragraph structure from TipTap.
 */
export function listToHtml(block: TipTapNode): string {
  const tag = block.type === 'orderedList' ? 'ol' : 'ul'
  const content = block.content
  if (!content || !Array.isArray(content)) return `<${tag}></${tag}>`

  const items = content.map((listItem: any) => {
    if (listItem.type !== 'listItem' || !listItem.content) return '<li></li>'

    // Each listItem can contain paragraphs (and nested lists)
    const innerHtml = listItem.content.map((child: any) => {
      if (child.type === 'paragraph') {
        return inlineContentToHtml(child.content)
      }
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        return listToHtml(child)
      }
      return ''
    }).join('')

    return `<li>${innerHtml}</li>`
  }).join('')

  return sanitizeHtml(`<${tag}>${items}</${tag}>`)
}

const inlineParagraphToHtml = (child: TipTapNode): string => `<p>${inlineContentToHtml(child.content || [])}</p>`

const blockquoteChildRenderers: Record<string, (child: TipTapNode) => string> = {
  paragraph: inlineParagraphToHtml,
  heading: inlineParagraphToHtml,
  bulletList: listToHtml,
  orderedList: listToHtml,
  blockquote: child => blockquoteToHtml(child)
}

function blockquoteChildToHtml(child: TipTapNode): string {
  const render = blockquoteChildRenderers[child.type ?? '']
  return render ? render(child) : ''
}

/** A quote: its paragraphs, lists and nested quotes inside `<blockquote>`. */
export function blockquoteToHtml(block: TipTapNode): string {
  const inner = (block.content || []).map(blockquoteChildToHtml).join('')
  return sanitizeHtml(`<blockquote>${inner}</blockquote>`)
}

/** A code block: its text, escaped, inside `<pre><code>`. Newlines are kept. */
export function codeBlockToHtml(block: TipTapNode): string {
  const text = (block.content || []).map(c => c.text || '').join('')
  return sanitizeHtml(`<pre><code>${escapeHtml(text)}</code></pre>`)
}

/** A divider. */
export function horizontalRuleToHtml(): string {
  return '<hr>'
}

export const blockHtmlRenderers: Record<string, (block: any) => string> = {
  bulletList: listToHtml,
  orderedList: listToHtml,
  blockquote: blockquoteToHtml,
  codeBlock: codeBlockToHtml,
  horizontalRule: horizontalRuleToHtml
}

/** Every native node type the public page renders (heading/paragraph have their own template branch). */
export const PUBLIC_NATIVE_BLOCK_TYPES: readonly string[] = ['heading', 'paragraph', ...Object.keys(blockHtmlRenderers)]

export function hasBlockHtmlRenderer(type: string | undefined): boolean {
  return !!type && Object.prototype.hasOwnProperty.call(blockHtmlRenderers, type)
}

export function blockToHtml(block: TipTapNode): string {
  if (!hasBlockHtmlRenderer(block.type)) return ''
  return blockHtmlRenderers[block.type as string]!(block)
}
