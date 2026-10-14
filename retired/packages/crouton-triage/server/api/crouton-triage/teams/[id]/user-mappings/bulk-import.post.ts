/**
 * Bulk Import User Mappings
 *
 * POST /api/user-mappings/bulk-import
 *
 * Accepts CSV or JSON array of user mappings and creates them in bulk.
 * Useful for initial setup or migration from other systems.
 */

import { bulkImportMappings } from '../../../../../services/userMapping'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  try {
    const body = await readBody(event)
    const { teamId, mappings } = body

    // Validate input
    if (!teamId) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Missing required field: teamId'
      })
    }

    if (!mappings || !Array.isArray(mappings)) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Missing or invalid field: mappings (must be an array)'
      })
    }

    if (mappings.length === 0) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Mappings array is empty'
      })
    }

    if (mappings.length > 1000) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Too many mappings. Maximum 1000 per import.'
      })
    }

    // Validate each mapping has required fields
    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i]

      if (!mapping.sourceType || !mapping.sourceUserId || !mapping.notionUserId) {
        throw createError({
          statusCode: 422,
          statusMessage: `Invalid mapping at index ${i}: missing required fields (sourceType, sourceUserId, notionUserId)`
        })
      }

      // Validate sourceType
      if (!['slack', 'figma'].includes(mapping.sourceType)) {
        throw createError({
          statusCode: 422,
          statusMessage: `Invalid mapping at index ${i}: sourceType must be 'slack' or 'figma'`
        })
      }
    }

    logger.debug(`[Bulk Import] Starting import of ${mappings.length} mappings for team ${teamId}`)

    // Call bulk import service
    const result = await bulkImportMappings(event, teamId, mappings)

    logger.debug(`[Bulk Import] Complete: ${result.success} success, ${result.failed} failed`)

    return {
      success: true,
      imported: result.success,
      failed: result.failed,
      errors: result.errors,
      total: mappings.length
    }
  } catch (error: any) {
    logger.error('[Bulk Import] Error:', error)

    // Pass through already formatted errors
    if (error.statusCode) {
      throw error
    }

    // Generic error
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import user mappings'
    })
  }
})
