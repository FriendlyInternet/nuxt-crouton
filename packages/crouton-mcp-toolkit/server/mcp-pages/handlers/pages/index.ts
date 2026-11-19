/**
 * `/mcp/pages` — live page tools for the Claude app (#3982).
 *
 * Loaded ONLY when the app sets `croutonMcpToolkit.pages: true` (module.ts adds
 * this folder through `mcp:definitions:paths`). Auth is a team pages token in
 * `?token=` (the Claude custom-connector form has no header field) or
 * `Authorization: Bearer`. No session fallback.
 */
import { createError, getHeader, getQuery } from 'h3'
import { pagesTokenFrom, resolvePagesAccess } from '../../lib/auth'

export default defineMcpHandler({
  name: 'pages',
  description: 'Edit this team\'s pages live: changes appear in the open page editor; the owner saves.',
  instructions: [
    'These tools change the LIVE document of a page — what the open editor shows. They never save: the owner reviews and clicks Save (Enregistrer).',
    'Start with list_pages, then read_page to see the blocks and their indexes. Use edit_page to insert / replace / delete TipTap blocks at an index.',
    'To place a layout: list_layout_blocks first, arrange the blocks into a panes tree ({ renderer: "panes", root: { type: "split", direction: "horizontal", children: [{ type: "leaf", blockId }] } }),',
    'keep it viable at 1280px (every block gets its minWidth — add_layout refuses otherwise), then add phone behaviour (breakpoints / collapse) for any 768 / 375 warnings add_layout returns.'
  ].join(' '),
  middleware: async (event) => {
    const token = pagesTokenFrom(getQuery(event) as Record<string, unknown>, getHeader(event, 'authorization'))
    const access = await resolvePagesAccess(token)
    if (!access) {
      throw createError({ status: 401, statusText: 'A pages token is required (/mcp/pages?token=…)' })
    }
    event.context.croutonMcpPages = access
  }
})
