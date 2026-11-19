import { z } from 'zod'
import { pageBodyText } from '../../utils/doc-text'

export default defineMcpTool({
  name: 'get_page',
  description: 'Get the full content of a specific documentation page by path. Use this after search_docs to get detailed content.',
  inputSchema: {
    path: z.string().describe('The documentation path (e.g., "/getting-started", "/fundamentals/collections", "/api-reference/composables")')
  },
  async handler({ path }) {
    const { queryCollection } = await import('@nuxt/content/server')
    const { useEvent } = await import('nitropack/runtime')

    // Normalize path
    const normalizedPath = path.startsWith('/') ? path : `/${path}`

    const results = await queryCollection(useEvent(), 'docs')
      .where('path', 'LIKE', `%${normalizedPath}%`)
      .limit(1)
      .all()

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `Page not found at path "${normalizedPath}". Use search_docs or list_sections to find available pages.`
        }]
      }
    }

    const doc = results[0]

    const bodyText = pageBodyText(doc)

    return {
      content: [{
        type: 'text' as const,
        text: `# ${doc.title || 'Untitled'}\n\n**Path:** ${doc.path}\n**Description:** ${doc.description || 'N/A'}\n\n---\n\n${bodyText || 'Content not available in text format. Please visit the documentation website for full content.'}`
      }]
    }
  }
})
