/**
 * #3982 T8 — the `/mcp/pages` handler files themselves (the ones
 * `mcp:definitions:paths` loads in production), not only the lib they call.
 * Rule A, handler side: no pages token → 401 at the handler middleware, and a
 * tool reached without access is refused before it touches a page or a room.
 *
 * `defineMcpTool` / `defineMcpHandler` are @nuxtjs/mcp-toolkit auto-imports,
 * stubbed as identity so the real definitions can be imported. `lib/deps` is
 * mocked: its real collaborators run in crouton-collab's collabServerDoc.test.ts
 * and crouton-pages' page-live-source.test.ts, and here they must never be called.
 */
import { describe, it, expect, vi } from 'vitest'
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
      pages: { listTeamPagesForMcp: spy('listTeamPagesForMcp'), getStoredPageContentForMcp: spy('getStoredPageContentForMcp') },
      room: { readCollabRoomDoc: spy('readCollabRoomDoc'), updateCollabRoomDoc: spy('updateCollabRoomDoc') },
      registry: {},
      checkLayout: () => ({ ok: false, errors: ['unused'], warnings: [] })
    }),
    pagesAccess: () => undefined
  }
})

vi.mock('../server/mcp-pages/lib/deps', () => ({
  pagesToolDeps: deps.pagesToolDeps,
  pagesAccess: deps.pagesAccess
}))

import pagesHandler from '../server/mcp-pages/handlers/pages/index'
import listPages from '../server/mcp-pages/handlers/pages/tools/list-pages'
import readPage from '../server/mcp-pages/handlers/pages/tools/read-page'
import editPage from '../server/mcp-pages/handlers/pages/tools/edit-page'
import addLayout from '../server/mcp-pages/handlers/pages/tools/add-layout'
import listLayoutBlocks from '../server/mcp-pages/handlers/pages/tools/list-layout-blocks'

type Tool = { name: string, handler: (args: any) => Promise<{ isError?: boolean, content: { text: string }[] }> }

describe('/mcp/pages handler definitions', () => {
  // covers: T8
  it('is the "pages" handler with exactly the five page tools', () => {
    expect((pagesHandler as { name: string }).name).toBe('pages')
    const names = [listPages, readPage, editPage, addLayout, listLayoutBlocks].map(t => (t as Tool).name).sort()
    expect(names).toEqual(['add_layout', 'edit_page', 'list_layout_blocks', 'list_pages', 'read_page'])
  })

  // covers: T8
  it('the handler middleware refuses a request with no pages token (401)', async () => {
    const middleware = (pagesHandler as unknown as { middleware: (e: H3Event) => Promise<void> }).middleware
    let reached = false
    const app = createApp()
    app.use(eventHandler(async (event) => {
      await middleware(event)
      reached = true
      return 'passed'
    }))
    const res = await toWebHandler(app)(new Request('https://velo.test/mcp/pages'))
    expect(res.status).toBe(401)
    expect(reached).toBe(false)
  })

  // covers: T8
  it('every tool without access is refused and touches no page or room', async () => {
    const args = { pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [], layout: {} }
    for (const tool of [listPages, readPage, editPage, addLayout, listLayoutBlocks] as Tool[]) {
      const res = await tool.handler(args)
      expect(res.isError, tool.name).toBe(true)
      expect(res.content[0]!.text, tool.name).toMatch(/Not authorised/)
    }
    expect(deps.calls).toEqual([])
  })
})
