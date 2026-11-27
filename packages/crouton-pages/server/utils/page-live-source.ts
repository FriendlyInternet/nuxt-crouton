/**
 * Page data for the MCP pages tools (#3982, #4193).
 *
 * Every query is scoped by `teamId` — a page id from another team reads as
 * not found. The reads only SELECT: the edit tools change the live collab room
 * and the owner saves. `createPageForMcp` is the one write: it inserts a NEW
 * page as a draft and never updates, publishes or deletes an existing one.
 */
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { pagesPages } from '../../collections/pages/server/database/schema'
import { createPagesPage } from '../../collections/pages/server/database/queries'

type Translations = Record<string, { title?: string, slug?: string, content?: unknown } | undefined>

export interface McpPageSummary {
  id: string
  pageType: string
  status: string
  parentId: string | null
  translations: Record<string, { title: string, slug: string }>
}

export interface McpStoredPageContent {
  id: string
  locale: string
  /** The saved TipTap doc for that locale, or null when it has none. */
  content: unknown | null
}

function parseContent(content: unknown): unknown | null {
  if (content === null || content === undefined || content === '') return null
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** The team's pages with their per-locale title and slug. */
export async function listTeamPagesForMcp(teamId: string): Promise<McpPageSummary[]> {
  const db = useDB()
  const rows = await (db as any)
    .select({
      id: pagesPages.id,
      pageType: pagesPages.pageType,
      status: pagesPages.status,
      parentId: pagesPages.parentId,
      title: pagesPages.title,
      slug: pagesPages.slug,
      translations: pagesPages.translations
    })
    .from(pagesPages)
    .where(eq(pagesPages.teamId, teamId))

  return (rows as SummaryRow[]).map(toSummary)
}

interface SummaryRow {
  id: string
  pageType: string
  status: string
  parentId: string | null
  title: string
  slug: string
  translations: Translations | null
}

function toSummary(row: SummaryRow): McpPageSummary {
  const translations: Record<string, { title: string, slug: string }> = {}
  for (const [locale, t] of Object.entries(row.translations ?? {})) {
    translations[locale] = { title: t?.title || row.title, slug: t?.slug || row.slug }
  }
  return { id: row.id, pageType: row.pageType, status: row.status, parentId: row.parentId ?? null, translations }
}

/**
 * The saved content of one locale of one of the team's pages, or `null` when
 * the page does not exist in THIS team.
 */
export async function getStoredPageContentForMcp(
  teamId: string,
  pageId: string,
  locale: string
): Promise<McpStoredPageContent | null> {
  const db = useDB()
  const rows = await (db as any)
    .select({ id: pagesPages.id, translations: pagesPages.translations })
    .from(pagesPages)
    .where(and(eq(pagesPages.id, pageId), eq(pagesPages.teamId, teamId)))
    .limit(1)

  const row = (rows as Array<{ id: string, translations: Translations | null }>)[0]
  if (!row) return null
  return { id: row.id, locale, content: parseContent(row.translations?.[locale]?.content) }
}

/** Every page setting a person can give a new page in the admin, except publishing. */
export interface McpCreatePageSettings {
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

export interface McpCreatePageInput extends McpCreatePageSettings {
  locale: string
  title: string
  slug: string
  parentId?: string
  /** TipTap block nodes; stored as `{ type: 'doc', content: blocks }`. */
  blocks?: unknown[]
}

export type McpCreatePageError = 'parent_not_found' | 'slug_taken'

/**
 * Insert a NEW page in the team as a draft (#4193). Always `status: 'draft'` and
 * `publishedAt: null` whatever the input carries — the column default would
 * otherwise set `publishedAt` to now. Refuses, writing nothing, when `parentId`
 * is not a page of THIS team, or when the slug is already used in the team (the
 * database's unique (teamId, slug) index). Path/depth follow the create endpoint.
 */
interface ParentRow { id: string, path: string, depth: number }

/** The parent page IN THIS team, or undefined. */
async function findTeamParent(teamId: string, parentId: string): Promise<ParentRow | undefined> {
  const rows = await (useDB() as any)
    .select({ id: pagesPages.id, path: pagesPages.path, depth: pagesPages.depth })
    .from(pagesPages)
    .where(and(eq(pagesPages.id, parentId), eq(pagesPages.teamId, teamId)))
    .limit(1)
  return (rows as ParentRow[])[0]
}

/** The database's unique (teamId, slug) rule, checked before the insert. */
async function slugTaken(teamId: string, slug: string): Promise<boolean> {
  const rows = await (useDB() as any)
    .select({ id: pagesPages.id })
    .from(pagesPages)
    .where(and(eq(pagesPages.teamId, teamId), eq(pagesPages.slug, slug)))
    .limit(1)
  return (rows as unknown[]).length > 0
}

/** Path/depth as the create endpoint computes them. */
function placement(id: string, parent: ParentRow | undefined) {
  if (!parent) return { parentId: null, path: `/${id}/`, depth: 0 }
  return { parentId: parent.id, path: `${parent.path}${id}/`, depth: (parent.depth || 0) + 1 }
}

/** The object without its undefined values, so defaults are not overwritten by them. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

const SETTING_DEFAULTS = { config: {}, pageType: 'pages:regular', visibility: 'public' }

/** The row to insert: defaults, then the settings, then the fields no setting may override. */
function draftRow(id: string, teamId: string, userId: string, input: McpCreatePageInput, parent: ParentRow | undefined) {
  const { locale, title, slug, parentId: _parentId, blocks, ...settings } = input
  const content = JSON.stringify({ type: 'doc', content: blocks ?? [] })
  const seo = defined({ seoTitle: settings.seoTitle, seoDescription: settings.seoDescription })
  return {
    ...SETTING_DEFAULTS,
    ...defined(settings as Record<string, unknown>),
    // Never published, whatever the settings carry (Rule C, #4193)
    status: 'draft',
    publishedAt: null,
    id,
    ...placement(id, parent),
    title,
    slug,
    content,
    translations: { [locale]: { title, slug, content, ...seo } },
    teamId,
    owner: userId,
    createdBy: userId,
    updatedBy: userId
  }
}

export async function createPageForMcp(
  teamId: string,
  userId: string,
  input: McpCreatePageInput
): Promise<{ data: { pageId: string } | null, error: McpCreatePageError | null }> {
  const parent = await resolveParent(teamId, input.parentId)
  if (parent === null) return { data: null, error: 'parent_not_found' }
  if (await slugTaken(teamId, input.slug)) return { data: null, error: 'slug_taken' }

  const id = nanoid()
  await createPagesPage(draftRow(id, teamId, userId, input, parent) as any)
  return { data: { pageId: id }, error: null }
}

/** undefined = top level (no parentId) · null = parentId is not a page of this team. */
async function resolveParent(teamId: string, parentId: string | undefined): Promise<ParentRow | null | undefined> {
  if (!parentId) return undefined
  return (await findTeamParent(teamId, parentId)) ?? null
}
