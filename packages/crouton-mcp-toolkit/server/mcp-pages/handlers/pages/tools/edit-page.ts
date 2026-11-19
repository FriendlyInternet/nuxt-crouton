import { z } from 'zod'
import { editPageTool } from '../../../lib/tools'
import { pagesAccess, pagesToolDeps } from '../../../lib/deps'

export default defineMcpTool({
  name: 'edit_page',
  description: 'Insert, replace or delete TipTap blocks at a block index in one locale of a page. "insert" puts blocks before index (index = block count appends); "replace" swaps count (default blocks.length) blocks; "delete" removes count (default 1). Returns the new block list. Changes go into the open editor; the owner clicks Save.',
  inputSchema: {
    pageId: z.string().describe('Page id from list_pages'),
    locale: z.string().describe('Locale, e.g. "fr"'),
    action: z.enum(['insert', 'replace', 'delete']),
    index: z.number().int().min(0).describe('Block index from read_page'),
    count: z.number().int().min(1).optional().describe('Blocks to replace / delete'),
    blocks: z.array(z.object({ type: z.string() }).passthrough()).optional()
      .describe('TipTap block nodes, e.g. { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Hi" }] }')
  },
  async handler({ pageId, locale, action, index, count, blocks }) {
    return editPageTool(pagesAccess(), { pageId, locale, action, index, count, blocks }, pagesToolDeps())
  }
})
