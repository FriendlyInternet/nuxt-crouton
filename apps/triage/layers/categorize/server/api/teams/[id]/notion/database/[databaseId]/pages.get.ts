/**
 * Fetch all pages from a Notion database
 *
 * GET /api/teams/[id]/notion/database/[databaseId]/pages?accountId=xxx
 * GET /api/teams/[id]/notion/database/[databaseId]/pages?notionToken=secret_xxx
 *
 * Returns simplified page objects with title, url, and key properties.
 * Handles pagination automatically (Notion returns max 100 per request).
 */

const NOTION_API_VERSION = '2022-06-28'

interface NotionUser {
  name?: string
  id: string
}

interface NotionPage {
  id: string
  title: string
  url: string
  properties: Record<string, unknown>
  createdTime: string
  lastEditedTime: string
  createdBy: NotionUser | null
  lastEditedBy: NotionUser | null
}

function extractTitle(properties: Record<string, any>): string {
  for (const prop of Object.values(properties)) {
    if (prop.type === 'title' && Array.isArray(prop.title)) {
      return prop.title.map((t: any) => t.plain_text).join('') || 'Untitled'
    }
  }
  return 'Untitled'
}

function extractUser(user: any): NotionUser | null {
  if (!user) return null
  return { name: user.name || undefined, id: user.id }
}

const propertySimplifiers: Record<string, (prop: any) => unknown> = {
  title: prop => prop.title?.map((t: any) => t.plain_text).join('') || '',
  rich_text: prop => prop.rich_text?.map((t: any) => t.plain_text).join('') || '',
  select: prop => prop.select?.name || null,
  multi_select: prop => prop.multi_select?.map((s: any) => s.name) || [],
  status: prop => prop.status?.name || null,
  number: prop => prop.number,
  checkbox: prop => prop.checkbox,
  date: prop => prop.date?.start || null,
  url: prop => prop.url || null,
  email: prop => prop.email || null,
  people: prop => prop.people?.map((p: any) => p.name || p.id) || [],
  created_by: prop => prop.created_by?.name || prop.created_by?.id || null,
  last_edited_by: prop => prop.last_edited_by?.name || prop.last_edited_by?.id || null,
  created_time: prop => prop.created_time || null,
  last_edited_time: prop => prop.last_edited_time || null,
}

function simplifyProperty(prop: any): unknown {
  const simplifier = Object.hasOwn(propertySimplifiers, prop.type)
    ? propertySimplifiers[prop.type]
    : undefined
  return simplifier ? simplifier(prop) : null
}

async function queryDatabasePage(databaseId: string, token: string, cursor: string | undefined): Promise<any> {
  const body: Record<string, unknown> = { page_size: 100 }
  if (cursor) body.start_cursor = cursor

  return await $fetch<any>(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
    },
    body,
  })
}

function simplifyPage(page: any): NotionPage {
  const simplifiedProps: Record<string, unknown> = {}
  let createdByFromProp: NotionUser | null = null
  let lastEditedByFromProp: NotionUser | null = null

  for (const [name, prop] of Object.entries(page.properties || {}) as [string, any][]) {
    simplifiedProps[name] = simplifyProperty(prop)
    // Extract full user objects from property columns (these have names)
    if (prop.type === 'created_by') createdByFromProp = extractUser(prop.created_by)
    if (prop.type === 'last_edited_by') lastEditedByFromProp = extractUser(prop.last_edited_by)
  }

  return {
    id: page.id,
    title: extractTitle(page.properties || {}),
    url: page.url,
    properties: simplifiedProps,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    createdBy: createdByFromProp || extractUser(page.created_by),
    lastEditedBy: lastEditedByFromProp || extractUser(page.last_edited_by),
  }
}

async function fetchAllPages(databaseId: string, token: string): Promise<NotionPage[]> {
  const allPages: NotionPage[] = []
  let cursor: string | undefined

  // Paginate through all pages
  do {
    const response = await queryDatabasePage(databaseId, token, cursor)

    for (const page of response.results || []) {
      allPages.push(simplifyPage(page))
    }

    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  return allPages
}

function toPagesError(error: any) {
  if (error.status === 401 || error.statusCode === 401) {
    return createError({ status: 401, statusText: 'Invalid Notion token' })
  }
  if (error.status === 404 || error.statusCode === 404) {
    return createError({ status: 404, statusText: 'Database not found. Check ID and integration access.' })
  }
  if (error.statusCode) return error

  return createError({
    status: 500,
    statusText: error.message || 'Failed to fetch Notion pages',
  })
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const teamId = getRouterParam(event, 'id')
  const databaseId = getRouterParam(event, 'databaseId')
  const query = getQuery(event)

  if (!teamId) {
    throw createError({ status: 422, statusText: 'Missing team ID' })
  }
  if (!databaseId) {
    throw createError({ status: 422, statusText: 'Missing databaseId' })
  }

  const token = await resolveNotionToken({
    accountId: query.accountId as string | undefined,
    notionToken: query.notionToken as string | undefined,
    teamId,
  })

  try {
    const allPages = await fetchAllPages(databaseId, token)

    return {
      success: true,
      databaseId,
      pages: allPages,
      total: allPages.length,
    }
  }
  catch (error: any) {
    throw toPagesError(error)
  }
})
