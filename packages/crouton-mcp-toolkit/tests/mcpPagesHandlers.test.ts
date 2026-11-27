/**
 * #4097 — the `/mcp` page-tools handler files themselves (the ones
 * `mcp:definitions:paths` loads in production), not only the lib they call.
 * Handler side: no sign-in token → 401 + `WWW-Authenticate` at the handler
 * middleware, and a tool reached without access is refused before it touches a
 * team, page or room.
 *
 * `defineMcpTool` / `defineMcpHandler` are @nuxtjs/mcp-toolkit auto-imports,
 * stubbed as identity so the real definitions can be imported. `lib/deps` is
 * mocked: its real collaborators run in crouton-collab's collabServerDoc.test.ts,
 * crouton-pages' page-live-source.test.ts and mcpPagesTeamLookup.test.ts, and
 * here they must never be called. `signInDeps` is replaced by fixed deps (its
 * real form needs crouton-auth's better-auth instance); `resolveSignInAccess`
 * runs for real.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp, eventHandler, toWebHandler, type H3Event } from 'h3'

const deps = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.defineMcpTool = (def: unknown) => def
  g.defineMcpHandler = (def: unknown) => def
  const calls: string[] = []
  const spy = (name: string) => async () => { calls.push(name); return null }
  return {
    calls,
    pagesToolDeps: () => ({
      teams: { findTeam: spy('findTeam'), canEditPages: spy('canEditPages'), listUserTeams: spy('listUserTeams') },
      pages: { listTeamPagesForMcp: spy('listTeamPagesForMcp'), getStoredPageContentForMcp: spy('getStoredPageContentForMcp'), createPageForMcp: spy('createPageForMcp') },
      room: { readCollabRoomDoc: spy('readCollabRoomDoc'), updateCollabRoomDoc: spy('updateCollabRoomDoc') },
      registry: {},
      checkLayout: () => ({ ok: false, errors: ['unused'], warnings: [] }),
      defaultLocale: 'en',
      pageTypes: ['pages:regular']
    }),
    pagesAccess: () => undefined
  }
})

vi.mock('../server/mcp-pages/lib/deps', () => ({
  pagesToolDeps: deps.pagesToolDeps,
  pagesAccess: deps.pagesAccess
}))

vi.mock('../server/mcp-pages/lib/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../server/mcp-pages/lib/auth')>()
  return {
    ...real,
    signInDeps: async () => ({
      origin: 'https://velo.test',
      issuer: 'https://velo.test/api/auth',
      jwks: async () => ({ keys: [] }),
      findConsent: async () => { deps.calls.push('findConsent'); return null }
    })
  }
})

import pagesHandler from '../server/mcp-pages/index'
import listTeams from '../server/mcp-pages/tools/list-teams'
import listPages from '../server/mcp-pages/tools/list-pages'
import readPage from '../server/mcp-pages/tools/read-page'
import editPage from '../server/mcp-pages/tools/edit-page'
import addLayout from '../server/mcp-pages/tools/add-layout'
import listLayoutBlocks from '../server/mcp-pages/tools/list-layout-blocks'
import createPage from '../server/mcp-pages/tools/create-page'

type Tool = { name: string, inputSchema: Record<string, unknown>, handler: (args: any) => Promise<{ isError?: boolean, content: { text: string }[] }> }
const ALL = [listTeams, listPages, readPage, editPage, addLayout, listLayoutBlocks, createPage] as unknown as Tool[]

describe('/mcp page-tools handler definitions', () => {
  // covers: T6
  it('is the unnamed default handler with exactly the seven page tools', () => {
    const def = pagesHandler as unknown as { name?: string, tools: Tool[] }
    expect(def.name).toBeUndefined()
    expect(def.tools.map(t => t.name).sort()).toEqual(['add_layout', 'create_page', 'edit_page', 'list_layout_blocks', 'list_pages', 'list_teams', 'read_page'])
    expect(def.tools).toEqual(ALL)
  })

  // covers: T6
  it('lists no resources and no prompts, so the shared pool (collection registry, data-entry) never falls through', () => {
    const def = pagesHandler as unknown as { resources?: unknown, prompts?: unknown }
    // The toolkit only skips its shared-pool fallback when the field is an array
    expect(def.resources).toEqual([])
    expect(def.prompts).toEqual([])
  })

  // covers: T6
  it('the old named handler folder is gone', () => {
    expect(existsSync(resolve(__dirname, '../server/mcp-pages/handlers'))).toBe(false)
  })

  // covers: T6
  it('every team-scoped tool takes a team argument; list_teams and list_layout_blocks do not', () => {
    for (const tool of ALL) {
      const wants = !['list_teams', 'list_layout_blocks'].includes(tool.name)
      expect('team' in tool.inputSchema, tool.name).toBe(wants)
    }
  })

  // covers: T6
  it('the handler middleware answers 401 + WWW-Authenticate for /mcp with no token', async () => {
    const middleware = (pagesHandler as unknown as { middleware: (e: H3Event) => Promise<void> }).middleware
    let reached = false
    const app = createApp()
    app.use(eventHandler(async (event) => {
      await middleware(event)
      reached = true
      return 'passed'
    }))
    const res = await toWebHandler(app)(new Request('https://velo.test/mcp', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Bearer resource_metadata="https://velo.test/.well-known/oauth-protected-resource/mcp", scope="pages offline_access"')
    expect(reached).toBe(false)
  })

  // covers: T6
  it('every tool without access is refused and touches no team, page or room', async () => {
    const args = { team: 'team-a', pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [], layout: {}, title: 'T', slug: 't' }
    for (const tool of ALL) {
      const res = await tool.handler(args)
      expect(res.isError, tool.name).toBe(true)
      expect(res.content[0]!.text, tool.name).toMatch(/Pas accès/)
    }
    expect(deps.calls).toEqual([])
  })
})
