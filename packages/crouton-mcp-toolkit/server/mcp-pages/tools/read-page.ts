import { z } from 'zod'
import { readPageTool } from '../lib/tools'
import { pagesAccess, pagesToolDeps } from '../lib/deps'

export default defineMcpTool({
  name: 'read_page',
  description: 'Read one locale of a page as a list of blocks (index, type, attrs, text) plus the TipTap doc. Reads the live document when the page has one (source "live"), else the saved page (source "stored"). Changes made with these tools go into the open editor; the owner clicks Save.',
  inputSchema: {
    team: z.string().describe('team slug or id from list_teams'),
    pageId: z.string().describe('Page id from list_pages'),
    locale: z.string().describe('Locale, e.g. "fr"')
  },
  async handler({ team, pageId, locale }) {
    return readPageTool(pagesAccess(), { team, pageId, locale }, pagesToolDeps())
  }
})
