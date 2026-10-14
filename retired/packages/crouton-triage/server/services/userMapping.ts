/**
 * User Mapping Service
 *
 * Maps users from source systems (Slack, Figma) to Notion users for proper @mentions.
 *
 * Features:
 * - Get or create user mappings
 * - Sync user info from source systems
 * - Resolve source users to Notion users
 * - Email-based matching with confidence scores
 * - Manual and automatic mapping support
 */

import { eq, and } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { logger } from '../utils/logger'

export interface UserMappingInput {
  teamId: string
  sourceType: string
  sourceUserId: string
  sourceUserEmail?: string
  sourceUserName?: string
  notionUserId?: string
  mappingType?: 'manual' | 'auto-email' | 'auto-name' | 'imported'
  confidence?: number
  metadata?: Record<string, any>
}

export interface UserMappingResult {
  id: string
  teamId: string
  sourceType: string
  sourceUserId: string
  sourceUserEmail?: string
  sourceUserName?: string
  notionUserId: string
  notionUserName?: string
  notionUserEmail?: string
  mappingType: string
  confidence: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export interface NotionMention {
  type: 'mention'
  mention: {
    type: 'user'
    user: {
      id: string
    }
  }
}

/**
 * Get or create a user mapping
 *
 * Looks up existing mapping by sourceType + sourceUserId.
 * If not found and notionUserId is provided, creates a new mapping.
 * If not found and no notionUserId, returns null.
 */
export async function getOrCreateUserMapping(
  event: H3Event,
  input: UserMappingInput
): Promise<UserMappingResult | null> {
  // @ts-expect-error Nitro auto-import
  const db = useDrizzle()
  // @ts-expect-error Nitro auto-import
  const { triageUsers: userMappings } = useTables()
  // @ts-expect-error Nitro auto-import
  const user = await requireUserSession(event)

  try {
    // Try to find existing mapping
    const existing = await db
      .select()
      .from(userMappings)
      .where(
        and(
          eq(userMappings.teamId, input.teamId),
          eq(userMappings.sourceType, input.sourceType),
          eq(userMappings.sourceUserId, input.sourceUserId),
          eq(userMappings.active, true)
        )
      )
      .get()

    if (existing) {
      // Update lastSyncedAt and source user info if provided
      if (input.sourceUserEmail || input.sourceUserName) {
        const updates: any = {
          lastSyncedAt: new Date().toISOString(),
          updatedBy: user.user.id
        }

        if (input.sourceUserEmail) updates.sourceUserEmail = input.sourceUserEmail
        if (input.sourceUserName) updates.sourceUserName = input.sourceUserName
        if (input.metadata) updates.metadata = input.metadata

        await db
          .update(userMappings)
          .set(updates)
          .where(eq(userMappings.id, existing.id))
          .run()

        return {
          ...existing,
          ...updates,
          confidence: existing.confidence || 1.0
        } as UserMappingResult
      }

      return {
        ...existing,
        confidence: existing.confidence || 1.0
      } as UserMappingResult
    }

    // If no Notion user ID provided, can't create mapping
    if (!input.notionUserId) {
      logger.debug(`[UserMapping] No mapping found and no notionUserId provided for ${input.sourceType}:${input.sourceUserId}`)
      return null
    }

    // Create new mapping
    const newMapping = {
      teamId: input.teamId,
      owner: user.user.id,
      sourceType: input.sourceType,
      sourceUserId: input.sourceUserId,
      sourceUserEmail: input.sourceUserEmail,
      sourceUserName: input.sourceUserName,
      notionUserId: input.notionUserId,
      mappingType: input.mappingType || 'manual',
      confidence: input.confidence ?? 1.0,
      active: true,
      lastSyncedAt: new Date().toISOString(),
      metadata: input.metadata || {},
      createdBy: user.user.id,
      updatedBy: user.user.id
    }

    const result = await db
      .insert(userMappings)
      .values(newMapping)
      .returning()
      .get()

    logger.debug(`[UserMapping] Created new mapping: ${input.sourceType}:${input.sourceUserId} -> Notion:${input.notionUserId}`)

    return result as UserMappingResult
  } catch (error) {
    logger.error('[UserMapping] Error in getOrCreateUserMapping', error)
    throw error
  }
}

/**
 * Resolve source user to Notion user ID
 *
 * Looks up mapping and returns Notion user ID if found.
 * Returns null if no mapping exists.
 */
export async function resolveToNotionUser(
  event: H3Event,
  teamId: string,
  sourceType: string,
  sourceUserId: string
): Promise<string | null> {
  const mapping = await getOrCreateUserMapping(event, {
    teamId,
    sourceType,
    sourceUserId
  })

  return mapping?.notionUserId || null
}

/**
 * Find user mapping by email (for auto-mapping)
 *
 * Attempts to find a Notion user mapping by matching email addresses.
 * Returns the mapping with highest confidence score if multiple matches.
 */
export async function findMappingByEmail(
  event: H3Event,
  teamId: string,
  sourceType: string,
  email: string
): Promise<UserMappingResult | null> {
  // @ts-expect-error Nitro auto-import
  const db = useDrizzle()
  // @ts-expect-error Nitro auto-import
  const { triageUsers: userMappings } = useTables()

  try {
    const results = await db
      .select()
      .from(userMappings)
      .where(
        and(
          eq(userMappings.teamId, teamId),
          eq(userMappings.sourceType, sourceType),
          eq(userMappings.sourceUserEmail, email),
          eq(userMappings.active, true)
        )
      )
      .all()

    if (results.length === 0) {
      return null
    }

    // Return mapping with highest confidence
    const sorted = results.sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
    return sorted[0] as UserMappingResult
  } catch (error) {
    logger.error('[UserMapping] Error finding mapping by email', error)
    return null
  }
}

/**
 * Build Notion mention rich text object
 *
 * Creates the proper Notion API format for @mentions.
 * If notionUserId is not provided, returns plain text instead.
 */
export function buildNotionMention(
  notionUserId: string | null,
  fallbackText?: string
): NotionMention | { type: 'text'; text: { content: string } } {
  if (!notionUserId) {
    return {
      type: 'text',
      text: {
        content: fallbackText || '@unknown'
      }
    }
  }

  return {
    type: 'mention',
    mention: {
      type: 'user',
      user: {
        id: notionUserId
      }
    }
  }
}

/**
 * Sync user info from Slack
 *
 * Fetches user details from Slack API and updates/creates mapping.
 * Requires Slack API token with users:read.email scope.
 */
export async function syncFromSlack(
  event: H3Event,
  teamId: string,
  slackUserId: string,
  slackToken: string,
  notionUserId?: string
): Promise<UserMappingResult | null> {
  try {
    // Fetch user info from Slack
    const userInfo = await $fetch<any>(`https://slack.com/api/users.info`, {
      params: { user: slackUserId },
      headers: { Authorization: `Bearer ${slackToken}` }
    })

    if (!userInfo.ok) {
      logger.error('[UserMapping] Slack API error', null, { error: userInfo.error })
      return null
    }

    const slackUser = userInfo.user
    const email = slackUser.profile?.email
    const name = slackUser.profile?.real_name || slackUser.name

    // Get or create mapping
    return await getOrCreateUserMapping(event, {
      teamId,
      sourceType: 'slack',
      sourceUserId: slackUserId,
      sourceUserEmail: email,
      sourceUserName: name,
      notionUserId,
      mappingType: notionUserId ? 'manual' : 'auto-email',
      confidence: email ? 0.9 : 0.5,
      metadata: {
        slackName: slackUser.name,
        slackRealName: slackUser.profile?.real_name,
        slackDisplayName: slackUser.profile?.display_name,
        slackAvatar: slackUser.profile?.image_72
      }
    })
  } catch (error) {
    logger.error('[UserMapping] Error syncing from Slack', error)
    return null
  }
}

/**
 * Sync user info from Figma
 *
 * For Figma, we typically only have email from comment notifications.
 * This creates/updates a mapping with email-based matching.
 */
export async function syncFromFigma(
  event: H3Event,
  teamId: string,
  figmaEmail: string,
  figmaName?: string,
  notionUserId?: string
): Promise<UserMappingResult | null> {
  try {
    // Use email as the user ID for Figma
    return await getOrCreateUserMapping(event, {
      teamId,
      sourceType: 'figma',
      sourceUserId: figmaEmail,
      sourceUserEmail: figmaEmail,
      sourceUserName: figmaName,
      notionUserId,
      mappingType: notionUserId ? 'manual' : 'auto-email',
      confidence: 0.8,
      metadata: {
        figmaEmail,
        figmaName
      }
    })
  } catch (error) {
    logger.error('[UserMapping] Error syncing from Figma', error)
    return null
  }
}

/**
 * Bulk import user mappings
 *
 * Creates multiple mappings at once from an import file or API.
 * Useful for initial setup or migration.
 */
export async function bulkImportMappings(
  event: H3Event,
  teamId: string,
  mappings: Array<{
    sourceType: string
    sourceUserId: string
    sourceUserEmail?: string
    sourceUserName?: string
    notionUserId: string
    notionUserName?: string
    notionUserEmail?: string
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  }

  for (const mapping of mappings) {
    try {
      await getOrCreateUserMapping(event, {
        teamId,
        sourceType: mapping.sourceType,
        sourceUserId: mapping.sourceUserId,
        sourceUserEmail: mapping.sourceUserEmail,
        sourceUserName: mapping.sourceUserName,
        notionUserId: mapping.notionUserId,
        mappingType: 'imported',
        confidence: 1.0,
        metadata: {
          notionUserName: mapping.notionUserName,
          notionUserEmail: mapping.notionUserEmail
        }
      })
      results.success++
    } catch (error) {
      results.failed++
      results.errors.push(`${mapping.sourceType}:${mapping.sourceUserId} - ${error}`)
      logger.error('[UserMapping] Bulk import error', error)
    }
  }

  logger.debug(`[UserMapping] Bulk import complete: ${results.success} success, ${results.failed} failed`)
  return results
}