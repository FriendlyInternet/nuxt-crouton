import { pageBodyText } from '../../utils/doc-text'

// Served from the Getting started pages themselves (docs/content/1.getting-started), not from a
// copy in this file. The hand-written copy that lived here described a `nuxt-crouton` package
// and YAML schemas that never existed, so the connector answered from it instead of the docs (#3168).
export default defineMcpResource({
  uri: 'crouton://getting-started',
  name: 'Crouton Getting Started Guide',
  description: 'The Getting started pages: what Crouton is, installation (crouton init or an existing app, crouton add), and generating a first collection',
  mimeType: 'text/markdown',
  async handler() {
    const { queryCollection } = await import('@nuxt/content/server')
    const { useEvent } = await import('nitropack/runtime')

    const pages = await queryCollection(useEvent(), 'docs')
      .where('path', 'LIKE', '/getting-started%')
      .order('stem', 'ASC')
      .all()

    const text = pages.length
      ? pages.map(p => `# ${p.title}\n\n**Path:** ${p.path}\n\n${pageBodyText(p)}`).join('\n\n---\n\n')
      : 'The Getting started pages could not be loaded. Use the get_page tool with path "/getting-started".'

    return {
      contents: [{
        uri: 'crouton://getting-started',
        mimeType: 'text/markdown',
        text
      }]
    }
  }
})
