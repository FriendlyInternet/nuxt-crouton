export default defineMcpTool({
  name: 'list_sections',
  description: 'List all documentation sections and their pages. Use this to understand the documentation structure.',
  inputSchema: {},
  async handler() {
    const { queryCollection } = await import('@nuxt/content/server')
    const { useEvent } = await import('nitropack/runtime')

    const results = await queryCollection(useEvent(), 'docs')
      .where('path', 'NOT LIKE', '/landing%')
      .order('path', 'ASC')
      .all()

    // Group by section
    const sections: Record<string, Array<{ title: string; path: string; description?: string }>> = {}

    for (const doc of results) {
      const pathParts = doc.path?.split('/').filter(Boolean) || []
      const section = pathParts[0] || 'root'

      if (!sections[section]) {
        sections[section] = []
      }

      sections[section].push({
        title: doc.title || 'Untitled',
        path: doc.path || '',
        description: doc.description
      })
    }

    const formattedSections = Object.entries(sections)
      .map(([section, pages]) => {
        const pageList = pages
          .map(p => `  - **${p.title}** (${p.path})${p.description ? `: ${p.description}` : ''}`)
          .join('\n')
        return `## ${section}\n${pageList}`
      })
      .join('\n\n')

    return {
      content: [{
        type: 'text' as const,
        text: `# Nuxt Crouton Documentation Structure\n\n${formattedSections}`
      }]
    }
  }
})
