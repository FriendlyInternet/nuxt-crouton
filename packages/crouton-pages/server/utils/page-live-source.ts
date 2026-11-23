import { and, eq } from 'drizzle-orm'
import { pagesPages } from '../../collections/pages/server/database/schema'
import { randomUUID } from 'crypto'

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

export interface CreateMcpPageInput {
  teamId: string
  pageType?: string
  parentId?: string | null
  visibility?: string
  seo?: Record<string, any>
  translations: Record<string, { title: string; slug: string; content?: unknown }>
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

/**
 * Creates a new page as a draft with all requested settings (except publishing).
 */
export async function createPageForMcp(input: CreateMcpPageInput): Promise<{ id: string }> {
  const db = useDB()
  const id = randomUUID()
  const now = new Date()

  const locales = Object.keys(input.translations)
  const defaultLocale = locales[0] || 'en'
  const defaultTranslation = input.translations[defaultLocale] || { title: 'Untitled', slug: 'untitled' }

  const formattedTranslations: Record<string, any> = {}
  for (const [locale, t] of Object.entries(input.translations)) {
    formattedTranslations[locale] = {
      title: t.title,
      slug: t.slug,
      content: t.content !== undefined ? t.content : null
    }
  }

  const pageData: Record<string, any> = {
    id,
    teamId: input.teamId,
    pageType: input.pageType || 'page',
    status: 'draft',
    parentId: input.parentId || null,
    visibility: input.visibility || 'public',
    seo: input.seo || {},
    title: defaultTranslation.title,
    slug: defaultTranslation.slug,
    translations: formattedTranslations,
    createdAt: now,
    updatedAt: now
  }

  await (db as any).insert(pagesPages).values(pageData)

  return { id }
}