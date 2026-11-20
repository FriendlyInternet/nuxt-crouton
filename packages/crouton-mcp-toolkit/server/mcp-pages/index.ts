/**
 * `/mcp` — the live page tools for the Claude app (#3982, #4097).
 *
 * The toolkit's DEFAULT handler (no `name`): loaded ONLY when the app sets
 * `croutonMcpToolkit.pages: true` AND `croutonAuth.mcpOAuth: true` (module.ts
 * adds this folder through `mcp:definitions:paths`). The user pastes
 * `<origin>/mcp` into the Claude app and signs in (crouton-auth's MCP OAuth,
 * #4096); every request carries `Authorization: Bearer <access token>`, checked
 * by `resolveSignInAccess`. No page key, no session fallback.
 *
 * The token names a user, never a team: each tool takes a `team` argument
 * (from `list_teams`), checked with `canEditPages` on every call.
 */
import { createError, getHeader, getRequestURL, setResponseHeader, type H3Event } from 'h3'
import { resolveSignInAccess, signInDeps } from './lib/auth'
import listTeams from './tools/list-teams'
import listPages from './tools/list-pages'
import readPage from './tools/read-page'
import editPage from './tools/edit-page'
import addLayout from './tools/add-layout'
import listLayoutBlocks from './tools/list-layout-blocks'

/**
 * The request as the sign-in check reads it (URL + `Authorization`). Built by hand
 * rather than with h3's `toWebRequest`, which h3 v2 no longer exports.
 */
function signInRequest(event: H3Event): Request {
  const authorization = getHeader(event, 'authorization')
  return new Request(getRequestURL(event), { headers: authorization ? { authorization } : {} })
}

export default defineMcpHandler({
  description: 'Edit your teams\' pages live: changes appear in the open page editor; the owner saves.',
  instructions: [
    'Start with list_teams: it lists your teams and whether you may edit each one\'s pages. Pass that team\'s slug or id as `team` to every page tool.',
    'These tools change the LIVE document of a page — what the open editor shows. They never save: the owner reviews and clicks Save (Enregistrer).',
    'Then list_pages, then read_page to see the blocks and their indexes. Use edit_page to insert / replace / delete TipTap blocks at an index.',
    'To place a layout: list_layout_blocks first, arrange the blocks into a panes tree ({ renderer: "panes", root: { type: "split", direction: "horizontal", children: [{ type: "leaf", blockId }] } }),',
    'keep it viable at 1280px (every block gets its minWidth — add_layout refuses otherwise), then add phone behaviour (breakpoints / collapse) for any 768 / 375 warnings add_layout returns.'
  ].join(' '),
  tools: [listTeams, listPages, readPage, editPage, addLayout, listLayoutBlocks],
  // Explicitly empty: a missing field makes the toolkit fall back to the shared
  // pool (`defaultHandlerStrategy: 'orphans'`), which would hand every signed-in
  // user the generic collection resources and the data-entry prompt.
  resources: [],
  prompts: [],
  middleware: async (event) => {
    const { data, error } = await resolveSignInAccess(signInRequest(event), await signInDeps(event))
    if (error) {
      const challenge = (error.headers as Record<string, string> | undefined)?.['WWW-Authenticate']
      // Set on the response (h3 v1 keeps it on a thrown error) AND on the error (h3 v2 reads it there)
      if (challenge) setResponseHeader(event, 'WWW-Authenticate', challenge)
      throw createError({
        status: error.statusCode,
        statusText: error.message,
        ...(challenge ? { headers: { 'WWW-Authenticate': challenge } } : {})
      } as Parameters<typeof createError>[0])
    }
    event.context.croutonMcpPages = data
  }
})
