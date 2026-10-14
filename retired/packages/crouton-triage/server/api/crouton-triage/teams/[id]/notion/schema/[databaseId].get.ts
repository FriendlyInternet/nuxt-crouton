/**
 * Fetch Notion database schema
 *
 * GET /api/notion/schema/:databaseId?notionToken=secret_xxx
 *
 * Returns the schema (properties) of a Notion database for field mapping configuration.
 * Parses property types and options (for select/multi-select fields).
 *
 * Note: Uses direct fetch calls instead of Notion SDK for edge compatibility (Cloudflare Workers)
 */

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  try {
    // Get database ID from route params
    const databaseId = getRouterParam(event, 'databaseId')

    // Get Notion token from query
    const query = getQuery(event)
    let notionToken = query.notionToken as string
    const accountId = query.accountId as string

    // Validate required parameters
    if (!databaseId) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Missing required parameter: databaseId'
      })
    }

    // Resolve token from account if accountId provided
    if (accountId && !notionToken) {
      const teamId = getRouterParam(event, 'id')
      if (teamId) {
        const { resolveAccountToken } = await import('../../../../../../utils/tokenResolver')
        notionToken = await resolveAccountToken(accountId, teamId)
      }
    }

    if (!notionToken) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Missing required parameter: notionToken or accountId'
      })
    }

    // Validate token format (Notion tokens start with 'secret_' or 'ntn_')
    if (!notionToken.startsWith('secret_') && !notionToken.startsWith('ntn_')) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Invalid Notion token format. Token must start with "secret_" or "ntn_"'
      })
    }

    // Fetch database schema using direct API call (edge-compatible)
    logger.debug(`[Notion Schema] Fetching schema for database ${databaseId}`)

    // Get database metadata using direct fetch (no SDK)
    const database = await $fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }) as any

    logger.debug(`[Notion Schema] Database metadata:`, JSON.stringify(database, null, 2) as any)

    // Handle both old format (properties directly on database) and new format (data_sources)
    let dataSourceProperties: Record<string, any>

    // Check if database has properties directly (old format with API version 2022-06-28)
    if ((database as any).properties) {
      logger.debug('[Notion Schema] Using old format - properties found directly on database')
      dataSourceProperties = (database as any).properties
    }
    // Check if database uses new data sources format
    else if ((database as any).data_sources && (database as any).data_sources.length > 0) {
      logger.debug('[Notion Schema] Using new format - fetching from data sources')
      const dataSources = (database as any).data_sources
      const dataSourceId = dataSources[0].id

      try {
        const dataSource = await $fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, {
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        })
        dataSourceProperties = (dataSource as any).properties
      } catch (fetchError: any) {
        logger.error('[Notion Schema] Data source fetch failed, falling back to query')

        // Fallback: query database for schema using direct API call
        const queryResponse = await $fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: {
            page_size: 1
          }
        }) as any

        if (!queryResponse.results || queryResponse.results.length === 0) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Database is empty. Cannot extract schema.'
          })
        }

        const firstPage = queryResponse.results[0] as any
        dataSourceProperties = {}
        for (const [name, value] of Object.entries(firstPage.properties)) {
          const propValue = value as any
          dataSourceProperties[name] = {
            id: propValue.id,
            type: propValue.type
          }
        }
      }
    }
    // No properties found at all
    else {
      throw createError({
        statusCode: 500,
        statusMessage: 'Cannot find database properties in either old or new format'
      })
    }

    if (!dataSourceProperties) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Data source has no properties'
      })
    }

    // Parse properties into a simpler format
    const properties: Record<string, any> = {}

    for (const [name, prop] of Object.entries(dataSourceProperties as Record<string, any>)) {
      // Extract property type
      const propertyType = prop.type

      // Base property info
      const propertyInfo: any = {
        type: propertyType,
        id: prop.id
      }

      // Extract select/multi-select options
      if (propertyType === 'select' && prop.select?.options) {
        propertyInfo.options = prop.select.options.map((opt: any) => ({
          name: opt.name,
          color: opt.color,
          id: opt.id
        }))
      } else if (propertyType === 'multi_select' && prop.multi_select?.options) {
        propertyInfo.options = prop.multi_select.options.map((opt: any) => ({
          name: opt.name,
          color: opt.color,
          id: opt.id
        }))
      } else if (propertyType === 'status' && prop.status?.options) {
        // Status fields also have options
        propertyInfo.options = prop.status.options.map((opt: any) => ({
          name: opt.name,
          color: opt.color,
          id: opt.id
        }))
      }

      properties[name] = propertyInfo
    }

    logger.debug(`[Notion Schema] Parsed ${Object.keys(properties).length} properties`)

    return {
      success: true,
      databaseId,
      databaseTitle: (database as any).title?.[0]?.plain_text || 'Unknown Database',
      properties
    }
  } catch (error: any) {
    logger.error('[Notion Schema] Error:', error)
    logger.error('[Notion Schema] Error stack:', error.stack)
    logger.error('[Notion Schema] Error details:', JSON.stringify(error, null, 2))

    // Handle Notion API errors
    if (error.code === 'unauthorized') {
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid Notion token or insufficient permissions'
      })
    }

    if (error.code === 'object_not_found') {
      throw createError({
        statusCode: 404,
        statusMessage: 'Notion database not found. Check database ID and integration access.'
      })
    }

    if (error.code === 'rate_limited') {
      throw createError({
        statusCode: 429,
        statusMessage: 'Notion API rate limit exceeded. Please try again later.'
      })
    }

    // Pass through already formatted errors
    if (error.statusCode) {
      throw error
    }

    // Generic error
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch Notion database schema'
    })
  }
})
