/**
 * Read-only page data for the MCP pages tools (#3982).
 *
 * Every query is scoped by `teamId` — a page id from another team reads as
 * not found. This module only SELECTs: the tools edit the live collab room and
 * the owner saves, so nothing here can write a page record.
 */
import { and, eq } from 'drizzle-orm'
import { pagesPages } from '../../collections/pages/server/database/schema'

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
