import { z } from 'zod'
import { addLayoutTool } from '../../../lib/tools'
import { pagesAccess, pagesToolDeps } from '../../../lib/deps'

export default defineMcpTool({
  name: 'add_layout',
  description: 'Insert a layout block (a panes tree of blocks from list_layout_blocks) before a block index in one locale of a page. Refused unless every block id is known and the layout is viable at 1280px; returns warnings for 768 / 375 so you can add phone behaviour. Changes go into the open editor; the owner clicks Save.',
  inputSchema: {
    pageId: z.string().describe('Page id from list_pages'),
    locale: z.string().describe('Locale, e.g. "fr"'),
    index: z.number().int().min(0).describe('Block index to insert before (block count appends)'),
    layout: z.union([z.string(), z.record(z.string(), z.any())])
      .describe('Layout tree, e.g. { "renderer": "panes", "root": { "type": "split", "direction": "horizontal", "children": [{ "type": "leaf", "blockId": "calendar" }, { "type": "leaf", "blockId": "bookings-list" }] } }'),
    height: z.number().int().min(120).max(4000).optional().describe('Block height in px (default 480)')
  },
  async handler({ pageId, locale, index, layout, height }) {
    return addLayoutTool(pagesAccess(), { pageId, locale, index, layout, height }, pagesToolDeps())
  }
})
