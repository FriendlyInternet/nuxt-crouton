/**
 * The five live-page tools (#3982), as plain functions with injected deps so the
 * two rules are testable without Nitro:
 *
 * - **Rule A — team isolation.** The team only ever comes from `ctx` (the pages
 *   token). Every page tool first asks the page source for the page IN THAT TEAM;
 *   `null` → `page not found`, before any room is read or written.
 * - **Rule B — never save for the owner.** The tools only touch the page's live
 *   collab room (what the open editor shows). They never write the page record —
 *   the owner reviews and clicks Save.
 *
 * The tool files in `handlers/pages/tools/` are thin glue that build `deps` from
 * crouton-pages / crouton-collab / crouton-layout and call these.
 */
import type * as Y from 'yjs'
import {
  editYFragment,
  hasFragmentContent,
  isTiptapElementNode,
  seedYFragment,
  yFragmentToTiptap,
  type FragmentEditOp,
  type TiptapNode
} from '@fyit/crouton-collab/shared/tiptap-yjs'
import type { PagesAccess } from './auth'

// ─── deps ───────────────────────────────────────────────────────────────────

export interface PagesToolPageSource {
  listTeamPagesForMcp: (teamId: string) => Promise<unknown[]>
  getStoredPageContentForMcp: (teamId: string, pageId: string, locale: string) => Promise<{ id: string, locale: string, content: unknown } | null>
}

export interface PagesToolRoomRef {
  teamId: string
  roomType: string
  roomId: string
  actorId: string
}

export interface PagesToolRoom {
  readCollabRoomDoc: (ref: PagesToolRoomRef) => Promise<{ doc: Y.Doc | null, error: string | null }>
  updateCollabRoomDoc: (ref: PagesToolRoomRef, mutate: (doc: Y.Doc) => void) => Promise<{ doc: Y.Doc | null, error: string | null }>
}

export interface PagesToolBlockDefinition {
  id: string
  name: string
  description?: string
  minWidth?: number
  minHeight?: number
  sizing?: unknown
  configSchema?: Array<{ name: string }>
}

export interface PagesToolLayoutCheck {
  ok: boolean
  tree?: unknown
  errors: string[]
  warnings: string[]
}

export interface PagesToolDeps {
  pages: PagesToolPageSource
  room: PagesToolRoom
  registry: Record<string, PagesToolBlockDefinition>
  checkLayout: (input: unknown, registry: any) => PagesToolLayoutCheck
}

// ─── results ────────────────────────────────────────────────────────────────

export interface PagesToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text', text: string }>
  isError?: boolean
}

function ok(data: unknown): PagesToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(message: string): PagesToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

const NO_ACCESS_ERROR = 'Not authorised: connect with a pages token (/mcp/pages?token=…)'
const PAGE_NOT_FOUND_ERROR = 'page not found'

// ─── helpers ────────────────────────────────────────────────────────────────

const PAGES_ROOM_TYPE = 'pagesPages'
const DEFAULT_PANE_HEIGHT = 480

function roomRef(ctx: PagesAccess, pageId: string): PagesToolRoomRef {
  return { teamId: ctx.teamId, roomType: PAGES_ROOM_TYPE, roomId: `${PAGES_ROOM_TYPE}-${pageId}`, actorId: `mcp:${ctx.tokenId}` }
}

/** The editor's fragment name for a locale (`fieldPrefix: 'content'`). */
function fragmentName(locale: string): string {
  return `content-${locale}`
}

function flattenText(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(flattenText).join(node.type === 'doc' ? '\n' : '')
}

function blockList(doc: { content?: TiptapNode[] }) {
  return (doc.content ?? []).map((node, index) => ({
    index,
    type: node.type,
    attrs: node.attrs ?? {},
    text: flattenText(node)
  }))
}

function parseStored(content: unknown): unknown {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** A block must be a TipTap node: an object with a string `type` that is not `doc`/`text`. */
function invalidBlocks(blocks: unknown[] | undefined): string | null {
  const i = (blocks ?? []).findIndex(block => !isTiptapElementNode(block))
  return i === -1 ? null : `blocks[${i}] must be a TipTap block node: an object with a string "type" (not "doc" or "text")`
}

/**
 * Seed the locale from the stored page when the live fragment is empty — the
 * same deterministic seed the editor runs (#3983), so the two merge into one
 * copy — then apply the edit.
 */
async function editLive(
  page: PageContext,
  op: FragmentEditOp,
  deps: PagesToolDeps,
  extra: Record<string, unknown> = {}
): Promise<PagesToolResult> {
  const { ctx, pageId, locale, stored } = page
  const name = fragmentName(locale)
  const out = await deps.room.updateCollabRoomDoc(roomRef(ctx, pageId), (doc) => {
    const fragment = doc.getXmlFragment(name)
    if (!hasFragmentContent(fragment)) {
      if (fragment.length > 0) fragment.delete(0, fragment.length)
      const content = parseStored(stored)
      if (content) seedYFragment(doc, name, content)
    }
    editYFragment(doc.getXmlFragment(name), op)
  })
  if (out.error || !out.doc) return fail(out.error ?? 'live edit failed')
  return ok({
    blocks: blockList(yFragmentToTiptap(out.doc.getXmlFragment(name))),
    ...extra,
    note: 'Changed in the open editor. The owner reviews and clicks Save.'
  })
}

interface PageContext {
  ctx: PagesAccess
  pageId: string
  locale: string
  /** The saved content of that locale (seed source). */
  stored: unknown
}

/**
 * Rule A gate shared by every page tool: no ctx → refused; the page must exist in
 * the TOKEN's team (else `page not found`) before `run` may touch any room.
 */
async function withPage(
  ctx: PagesAccess | undefined,
  args: { pageId: string, locale: string },
  deps: PagesToolDeps,
  run: (page: PageContext) => Promise<PagesToolResult>
): Promise<PagesToolResult> {
  if (!ctx) return fail(NO_ACCESS_ERROR)
  const stored = await deps.pages.getStoredPageContentForMcp(ctx.teamId, args.pageId, args.locale)
  if (!stored) return fail(PAGE_NOT_FOUND_ERROR)
  return run({ ctx, pageId: args.pageId, locale: args.locale, stored: stored.content })
}

// ─── tools ──────────────────────────────────────────────────────────────────

export async function listPagesTool(ctx: PagesAccess | undefined, deps: PagesToolDeps): Promise<PagesToolResult> {
  if (!ctx) return fail(NO_ACCESS_ERROR)
  return ok(await deps.pages.listTeamPagesForMcp(ctx.teamId))
}

export async function readPageTool(
  ctx: PagesAccess | undefined,
  args: { pageId: string, locale: string },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withPage(ctx, args, deps, async ({ ctx: access, pageId, locale, stored }) => {
    const live = await deps.room.readCollabRoomDoc(roomRef(access, pageId))
    const fragment = live.doc?.getXmlFragment(fragmentName(locale))
    if (fragment && hasFragmentContent(fragment)) {
      const doc = yFragmentToTiptap(fragment)
      return ok({ source: 'live', blocks: blockList(doc), doc })
    }
    const doc = (parseStored(stored) as { content?: TiptapNode[] } | null) ?? { type: 'doc', content: [] }
    return ok({ source: 'stored', blocks: blockList(doc), doc, ...(live.error ? { liveError: live.error } : {}) })
  })
}

export async function editPageTool(
  ctx: PagesAccess | undefined,
  args: { pageId: string, locale: string, action: FragmentEditOp['action'], index: number, count?: number, blocks?: unknown[] },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withPage(ctx, args, deps, async (page) => {
    const bad = invalidBlocks(args.blocks)
    if (bad) return fail(bad)
    return editLive(page, { action: args.action, index: args.index, count: args.count, blocks: args.blocks }, deps)
  })
}

export function listLayoutBlocksTool(deps: PagesToolDeps): PagesToolResult {
  return ok(Object.values(deps.registry ?? {}).map(b => ({
    id: b.id,
    name: b.name,
    description: b.description ?? '',
    minWidth: b.minWidth ?? 0,
    minHeight: b.minHeight ?? 0,
    sizing: b.sizing ?? null,
    config: (b.configSchema ?? []).map(f => f.name)
  })))
}

export async function addLayoutTool(
  ctx: PagesAccess | undefined,
  args: { pageId: string, locale: string, index: number, layout: unknown, height?: number },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withPage(ctx, args, deps, async (page) => {
    const check = deps.checkLayout(args.layout, deps.registry)
    if (!check.ok || !check.tree) return fail(`layout refused: ${check.errors.join('; ')}`)
    const paneBlock = { type: 'paneBlock', attrs: { layout: check.tree, height: args.height ?? DEFAULT_PANE_HEIGHT } }
    return editLive(page, { action: 'insert', index: args.index, blocks: [paneBlock] }, deps, { warnings: check.warnings })
  })
}
