/**
 * The seven page tools (#3982, #4097, #4193), as plain functions with injected deps so
 * the rules are testable without Nitro:
 *
 * - **Rule A — team isolation.** The team comes from the tool's `team` argument
 *   and is checked with crouton-auth's `canEditPages(teamId, userId)` before any
 *   page or room is read (else `pas accès aux pages de cette équipe`). Every page
 *   tool then asks the page source for the page IN THAT TEAM; `null` →
 *   `page not found`, before any room is read or written.
 * - **Rule B — never save for the owner.** The tools only touch the page's live
 *   collab room (what the open editor shows). They never write the page record —
 *   the owner reviews and clicks Save. Exception: `create_page` (Rule C).
 * - **Rule C — create only drafts (#4193).** `create_page` inserts a NEW page,
 *   always `status: 'draft'` with no `publishedAt`; it refuses any status /
 *   publishedAt input. No tool publishes or deletes a page.
 *
 * The tool files in `server/mcp-pages/tools/` are thin glue that build `deps` from
 * crouton-pages / crouton-collab / crouton-layout / crouton-auth and call these.
 */
import type * as Y from 'yjs'
import {
  caretForFragmentEdit,
  editYFragment,
  hasFragmentContent,
  isTiptapElementNode,
  seedClientId,
  seedYFragment,
  yFragmentToTiptap,
  type FragmentEditOp,
  type TiptapNode
} from '@fyit/crouton-collab/shared/tiptap-yjs'
import type { PagesAccess } from './auth'

// ─── deps ───────────────────────────────────────────────────────────────────

/** The page settings `create_page` may give a new page (everything but publishing). */
export interface PagesToolCreateSettings {
  pageType?: string
  visibility?: string
  showInNavigation?: boolean
  layout?: string
  seoTitle?: string
  seoDescription?: string
  ogImage?: string
  robots?: string
  config?: Record<string, unknown>
}

export interface PagesToolCreateInput extends PagesToolCreateSettings {
  locale: string
  title: string
  slug: string
  parentId?: string
  blocks?: unknown[]
}

export interface PagesToolPageSource {
  listTeamPagesForMcp: (teamId: string) => Promise<unknown[]>
  getStoredPageContentForMcp: (teamId: string, pageId: string, locale: string) => Promise<{ id: string, locale: string, content: unknown } | null>
  /** crouton-pages' one write: a NEW draft page (#4193). */
  createPageForMcp: (teamId: string, userId: string, input: PagesToolCreateInput) => Promise<{
    data: { pageId: string } | null
    error: 'parent_not_found' | 'slug_taken' | null
  }>
}

export interface PagesToolRoomRef {
  teamId: string
  roomType: string
  roomId: string
  actorId: string
}

/** The editor's short-lived presence sent with an edit (#4094) — crouton-collab's `CollabServerPresence`. */
export interface PagesToolPresence {
  clientId: number
  user: { id: string, name: string, color: string }
  caret: { anchor: unknown, head: unknown } | null
  fragment: string
  block: { index: number, type: string } | null
}

export interface PagesToolRoom {
  readCollabRoomDoc: (ref: PagesToolRoomRef) => Promise<{ doc: Y.Doc | null, error: string | null }>
  updateCollabRoomDoc: (
    ref: PagesToolRoomRef,
    mutate: (doc: Y.Doc) => void,
    options?: { presence?: (doc: Y.Doc) => PagesToolPresence | null }
  ) => Promise<{ doc: Y.Doc | null, error: string | null }>
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

export interface PagesToolTeam {
  id: string
  slug: string
  name: string
}

export interface PagesToolTeams {
  /** A team by id, else by slug; null when neither matches. */
  findTeam: (idOrSlug: string) => Promise<PagesToolTeam | null>
  /** The single page-edit rule (crouton-auth `canEditPages`). */
  canEditPages: (teamId: string, userId: string) => Promise<boolean>
  /** The user's teams, straight from the database (no session). */
  listUserTeams: (userId: string) => Promise<Array<PagesToolTeam & { role: string }>>
}

export interface PagesToolDeps {
  teams: PagesToolTeams
  pages: PagesToolPageSource
  room: PagesToolRoom
  registry: Record<string, PagesToolBlockDefinition>
  checkLayout: (input: unknown, registry: any) => PagesToolLayoutCheck
  /** The app's default locale — a new page starts in it (the create endpoint's rule). */
  defaultLocale: string
  /** The registered page type ids (`appId:typeId`, `layer:collection-detail`). */
  pageTypes: string[]
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

const NO_ACCESS_ERROR = 'Pas accès : connectez-vous via <origin>/mcp'
const TEAM_NO_ACCESS_ERROR = 'pas accès aux pages de cette équipe'
const PAGE_NOT_FOUND_ERROR = 'page not found'

// ─── helpers ────────────────────────────────────────────────────────────────

const PAGES_ROOM_TYPE = 'pagesPages'
const DEFAULT_PANE_HEIGHT = 480

function roomRef(teamId: string, ctx: PagesAccess, pageId: string): PagesToolRoomRef {
  return { teamId, roomType: PAGES_ROOM_TYPE, roomId: `${PAGES_ROOM_TYPE}-${pageId}`, actorId: `mcp:${ctx.tokenId}` }
}

/** Who the open editor shows while the tools edit (#4094): one name, one colour. */
const CLAUDE_NAME = 'Claude'
const CLAUDE_COLOR = '#d97757'

/**
 * Claude's presence after `op` ran on `fragmentName`: a stable clientId per pages
 * token, and the caret at the edited block (see `caretForFragmentEdit`).
 */
function claudePresence(ctx: PagesAccess, doc: Y.Doc, name: string, op: FragmentEditOp): PagesToolPresence {
  const actorId = `mcp:${ctx.tokenId}`
  const at = caretForFragmentEdit(doc.getXmlFragment(name), op)
  return {
    clientId: seedClientId(`presence:${actorId}`),
    user: { id: actorId, name: CLAUDE_NAME, color: CLAUDE_COLOR },
    caret: at?.caret ?? null,
    fragment: name,
    block: at?.block ?? null
  }
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
  const { ctx, teamId, pageId, locale, stored } = page
  const name = fragmentName(locale)
  const out = await deps.room.updateCollabRoomDoc(roomRef(teamId, ctx, pageId), (doc) => {
    const fragment = doc.getXmlFragment(name)
    if (!hasFragmentContent(fragment)) {
      if (fragment.length > 0) fragment.delete(0, fragment.length)
      const content = parseStored(stored)
      if (content) seedYFragment(doc, name, content)
    }
    editYFragment(doc.getXmlFragment(name), op)
  }, { presence: doc => claudePresence(ctx, doc, name, op) })
  if (out.error || !out.doc) return fail(out.error ?? 'live edit failed')
  return ok({
    blocks: blockList(yFragmentToTiptap(out.doc.getXmlFragment(name))),
    ...extra,
    note: 'Changed in the open editor. The owner reviews and clicks Save.'
  })
}

interface PageContext {
  ctx: PagesAccess
  /** The team the call named, already checked with `canEditPages`. */
  teamId: string
  pageId: string
  locale: string
  /** The saved content of that locale (seed source). */
  stored: unknown
}

/**
 * Rule A, team side: no ctx → refused; the named team must exist and the user
 * must pass `canEditPages` — else refused before any page or room dep is called.
 */
async function withTeam(
  ctx: PagesAccess | undefined,
  team: string | undefined,
  deps: PagesToolDeps,
  run: (ctx: PagesAccess, teamId: string) => Promise<PagesToolResult>
): Promise<PagesToolResult> {
  if (!ctx) return fail(NO_ACCESS_ERROR)
  if (typeof team !== 'string' || !team) return fail(TEAM_NO_ACCESS_ERROR)
  const found = await deps.teams.findTeam(team)
  if (!found) return fail(TEAM_NO_ACCESS_ERROR)
  if (!(await deps.teams.canEditPages(found.id, ctx.userId))) return fail(TEAM_NO_ACCESS_ERROR)
  return run(ctx, found.id)
}

/**
 * Rule A gate shared by every page tool: the team check (`withTeam`), then the
 * page must exist in THAT team (else `page not found`) before `run` may touch any room.
 */
async function withPage(
  ctx: PagesAccess | undefined,
  args: { team: string, pageId: string, locale: string },
  deps: PagesToolDeps,
  run: (page: PageContext) => Promise<PagesToolResult>
): Promise<PagesToolResult> {
  return withTeam(ctx, args.team, deps, async (access, teamId) => {
    const stored = await deps.pages.getStoredPageContentForMcp(teamId, args.pageId, args.locale)
    if (!stored) return fail(PAGE_NOT_FOUND_ERROR)
    return run({ ctx: access, teamId, pageId: args.pageId, locale: args.locale, stored: stored.content })
  })
}

// ─── tools ──────────────────────────────────────────────────────────────────

/** The signed-in user's teams, each with whether they may edit its pages. */
export async function listTeamsTool(ctx: PagesAccess | undefined, deps: PagesToolDeps): Promise<PagesToolResult> {
  if (!ctx) return fail(NO_ACCESS_ERROR)
  const teams = await deps.teams.listUserTeams(ctx.userId)
  const rows = await Promise.all(teams.map(async team => ({
    id: team.id,
    slug: team.slug,
    name: team.name,
    role: team.role,
    canEditPages: await deps.teams.canEditPages(team.id, ctx.userId)
  })))
  return ok(rows)
}

export async function listPagesTool(
  ctx: PagesAccess | undefined,
  args: { team: string },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withTeam(ctx, args.team, deps, async (_access, teamId) => ok(await deps.pages.listTeamPagesForMcp(teamId)))
}

export async function readPageTool(
  ctx: PagesAccess | undefined,
  args: { team: string, pageId: string, locale: string },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withPage(ctx, args, deps, async ({ ctx: access, teamId, pageId, locale, stored }) => {
    const live = await deps.room.readCollabRoomDoc(roomRef(teamId, access, pageId))
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
  args: { team: string, pageId: string, locale: string, action: FragmentEditOp['action'], index: number, count?: number, blocks?: unknown[] },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withPage(ctx, args, deps, async (page) => {
    const bad = invalidBlocks(args.blocks)
    if (bad) return fail(bad)
    return editLive(page, { action: args.action, index: args.index, count: args.count, blocks: args.blocks }, deps)
  })
}

/** Reads only the app's block registry (no team data): needs access, no `team` argument. */
export function listLayoutBlocksTool(ctx: PagesAccess | undefined, deps: PagesToolDeps): PagesToolResult {
  if (!ctx) return fail(NO_ACCESS_ERROR)
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

const NEVER_PUBLISH_ERROR = 'create_page never publishes: leave status/publishedAt out, publish in the Pages admin'

/**
 * Rule C: a new page in the team, always a draft. Refusals write nothing:
 * status/publishedAt given, no access (Rule A), not the default locale, an
 * unknown pageType, invalid blocks, an unknown parent, a slug already used.
 */
export async function createPageTool(
  ctx: PagesAccess | undefined,
  args: PagesToolCreateInput & { team: string },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  const raw = args as { status?: unknown, publishedAt?: unknown }
  if (raw.status !== undefined || raw.publishedAt !== undefined) return fail(NEVER_PUBLISH_ERROR)
  return withTeam(ctx, args.team, deps, async (access, teamId) => {
    const refused = createInputRefusal(args, deps)
    if (refused) return fail(refused)
    const { team: _team, ...input } = args
    const out = await deps.pages.createPageForMcp(teamId, access.userId, input)
    if (!out.data) return fail(createErrorMessage(out.error, args.slug))
    return ok({
      pageId: out.data.pageId,
      status: 'draft',
      note: 'Created as a draft. Nothing is public until someone publishes it in the Pages admin.'
    })
  })
}

/** The input checks that need the app (locale, page type) plus the blocks check; null = fine. */
function createInputRefusal(args: PagesToolCreateInput, deps: PagesToolDeps): string | null {
  if (args.locale !== deps.defaultLocale) {
    return `create the page in the default locale "${deps.defaultLocale}" first; add other locales with edit_page`
  }
  if (args.pageType !== undefined && !deps.pageTypes.includes(args.pageType)) {
    return `unknown pageType "${args.pageType}"; known: ${deps.pageTypes.join(', ')}`
  }
  return invalidBlocks(args.blocks)
}

function createErrorMessage(error: 'parent_not_found' | 'slug_taken' | null, slug: string): string {
  if (error === 'parent_not_found') return 'parent page not found'
  if (error === 'slug_taken') return `slug "${slug}" is already used in this team`
  return 'page not created'
}

export async function addLayoutTool(
  ctx: PagesAccess | undefined,
  args: { team: string, pageId: string, locale: string, index: number, layout: unknown, height?: number },
  deps: PagesToolDeps
): Promise<PagesToolResult> {
  return withPage(ctx, args, deps, async (page) => {
    const check = deps.checkLayout(args.layout, deps.registry)
    if (!check.ok || !check.tree) return fail(`layout refused: ${check.errors.join('; ')}`)
    const paneBlock = { type: 'paneBlock', attrs: { layout: check.tree, height: args.height ?? DEFAULT_PANE_HEIGHT } }
    return editLive(page, { action: 'insert', index: args.index, blocks: [paneBlock] }, deps, { warnings: check.warnings })
  })
}
