// Plain text of a docs page, for the MCP connector (get_page, crouton://getting-started).
// One reader, so a resource can never serve different words than the page it is about (#3168).

/** Content v3 minimark: a node is a string or [tag, props, ...children]. */
export function minimarkToText(nodes: unknown[]): string {
  let text = ''
  for (const node of nodes) {
    if (typeof node === 'string') {
      text += node
    } else if (Array.isArray(node)) {
      const [tag, , ...children] = node
      text += minimarkToText(children)
      if (typeof tag === 'string' && (tag === 'p' || tag === 'pre' || tag === 'li' || /^h[1-6]$/.test(tag))) {
        text += '\n\n'
      }
    }
  }
  return text.trim()
}

/** The text of a queried page's body, or '' when it has none. */
export function pageBodyText(doc: { body?: unknown }): string {
  const value = (doc.body as { value?: unknown } | undefined)?.value
  return Array.isArray(value) ? minimarkToText(value) : ''
}
