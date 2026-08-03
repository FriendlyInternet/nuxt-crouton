/// <reference path="../crouton-hooks.d.ts" />

import { useNitroApp } from 'nitropack/runtime'

/**
 * Notion Service - Task Creation in Notion Databases
 *
 * Provides:
 * - Generic task creation from any source (Figma, Slack, etc.)
 * - Rich content blocks with AI summaries and action items
 * - Rate limiting (200ms delays between tasks)
 * - Retry logic with exponential backoff
 * - Official Notion SDK integration
 *
 * Design decisions:
 * - Only uses "Name" property to avoid database-specific property errors
 * - All other data goes into page content blocks
 * - Generic metadata section works for any source type
 * - Functional exports (not class-based)
 */

import type {
  AISummary,
  DetectedTask,
  DiscussionThread,
  NotionTaskConfig,
  NotionTaskResult,
  FlowOutput,
  NotionOutputConfig,
} from '../../app/types'
import { retryWithBackoff } from '../utils/retry'
import { logger } from '../utils/logger'
import { parseContentWithLinks, parseContentWithMentionsAndLinks } from '../utils/emoji-converter'

/**
 * Notion API Version
 * https://developers.notion.com/reference/versioning
 */
const NOTION_API_VERSION = '2022-06-28'

/**
 * Source metadata for building message URLs
 */
export interface SourceMetadata {
  sourceType: 'figma' | 'slack' | 'notion'
  fileKey?: string // Figma
  channelId?: string // Slack
  slackTeamId?: string // Slack
  pageId?: string // Notion - page where comments are located
}

/**
 * Build a URL to a specific message in the source platform
 *
 * @param messageId - The message/comment ID
 * @param metadata - Source-specific metadata for URL construction
 * @returns URL to the message or null if metadata is insufficient
 */
function buildMessageUrl(
  messageId: string,
  metadata?: SourceMetadata,
): string | null {
  if (!metadata) return null

  if (metadata.sourceType === 'figma' && metadata.fileKey) {
    return `https://www.figma.com/file/${metadata.fileKey}#comment-${messageId}`
  }

  if (metadata.sourceType === 'slack' && metadata.channelId && metadata.slackTeamId) {
    return `https://slack.com/app_redirect?team=${metadata.slackTeamId}&channel=${metadata.channelId}&message_ts=${messageId}`
  }

  // Notion: Link to the page where the comment thread is located
  // Notion doesn't have direct comment permalinks, so we link to the page
  if (metadata.sourceType === 'notion' && metadata.pageId) {
    const cleanPageId = metadata.pageId.replace(/-/g, '')
    return `https://notion.so/${cleanPageId}`
  }

  return null
}

/**
 * Get Notion API key from config, runtime, or environment
 *
 * Checks in this order:
 * 1. apiKey parameter (passed explicitly)
 * 2. Environment variable (for standalone testing)
 * 3. Nuxt runtime config (for Nuxt context)
 */
function getNotionApiKey(apiKey?: string): string {
  let key = apiKey || process.env.NOTION_API_KEY

  // Try Nuxt runtime config if not in env (and if available)
  if (!key) {
    try {
      let event
      try { event = useEvent() } catch {}
      const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
      key = config.notionApiKey as string | undefined
    }
    catch {
      // useRuntimeConfig not available (standalone testing)
    }
  }

  if (!key) {
    throw new Error('NOTION_API_KEY is not configured')
  }

  return key
}

/**
 * Create NotionTaskConfig from FlowOutput (for flows architecture)
 *
 * Extracts Notion-specific configuration from a FlowOutput's outputConfig.
 * Validates that the output is of type 'notion' and has required fields.
 *
 * @param output - The flow output (must be type 'notion')
 * @param sourceType - Source type for metadata
 * @param sourceUrl - Source URL for deep linking
 * @returns NotionTaskConfig ready for task creation
 * @throws Error if output is not Notion type or missing required config
 */
export async function createNotionConfigFromOutput(
  output: FlowOutput,
  sourceType: string,
  sourceUrl: string,
  teamId?: string,
): Promise<{ config: NotionTaskConfig; fieldMapping?: Record<string, any> }> {
  if (output.outputType !== 'notion') {
    throw new Error(`Output ${output.id} is not a Notion output (type: ${output.outputType})`)
  }

  const notionConfig = output.outputConfig as NotionOutputConfig

  // Resolve token: prefer connected account, fall back to inline
  let notionToken: string | undefined
  if (output.accountId && teamId) {
    try {
      const { resolveOutputToken } = await import('../utils/tokenResolver')
      notionToken = await resolveOutputToken(output, teamId)
    } catch (error) {
      logger.warn('Failed to resolve output token from account, falling back to inline', {
        outputId: output.id,
        accountId: output.accountId,
        error,
      })
      notionToken = notionConfig.notionToken
    }
  } else {
    notionToken = notionConfig.notionToken
  }

  if (!notionToken) {
    throw new Error(`Output ${output.id} missing notionToken — no account or inline token configured`)
  }

  if (!notionConfig.databaseId) {
    throw new Error(`Output ${output.id} missing databaseId in outputConfig`)
  }

  logger.debug('Created Notion config from output', {
    outputId: output.id,
    outputType: output.outputType,
    databaseId: notionConfig.databaseId,
    hasFieldMapping: !!notionConfig.fieldMapping,
    resolvedViaAccount: !!output.accountId,
  })

  return {
    config: {
      databaseId: notionConfig.databaseId,
      apiKey: notionToken,
      sourceType,
      sourceUrl,
    },
    fieldMapping: notionConfig.fieldMapping,
  }
}

/**
 * Make a request to the Notion API using edge-compatible fetch
 *
 * Replaces the @notionhq/client SDK for Cloudflare Workers compatibility.
 *
 * @see https://developers.notion.com/reference/intro
 */
async function notionRequest(
  endpoint: string,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    apiKey: string
    body?: any
  }
): Promise<any> {
  const url = `https://api.notion.com/v1/${endpoint}`

  try {
    // Log sanitized request body for debugging
    if (options.body) {
      logger.debug('Notion API request', {
        url,
        method: options.method,
        bodyPreview: JSON.stringify(options.body).substring(0, 200),
      })
    }

    const response = await $fetch(url, {
      method: options.method,
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    logger.debug('Notion API request successful', { url })
    return response
  } catch (error: any) {
    // Extract detailed error information from Notion API
    const errorDetails = error.data || error.response?._data || {}
    logger.error('Notion API request failed', error, {
      url,
      method: options.method,
      status: error.status || error.statusCode,
      statusText: error.statusText,
      message: error.message,
      notionErrorMessage: errorDetails.message,
      notionErrorCode: errorDetails.code,
      notionErrorDetails: errorDetails,
    })

    // Re-throw the original error
    throw error
  }
}

/**
 * Cache of databaseId → title property name.
 *
 * Every Notion database has exactly one property of type `title`, but its name
 * varies (could be "Name", "Task", "Title", etc.). We fetch the database schema
 * once per databaseId and cache the title property name to avoid hardcoding
 * "Name" (which fails for any database that uses a different name).
 */
const titlePropertyCache = new Map<string, string>()

/**
 * Look up the title property name for a Notion database.
 * Returns the property name (cached after first fetch). Falls back to "Name"
 * if the lookup fails so we still attempt the insert.
 */
async function getTitlePropertyName(apiKey: string, databaseId: string): Promise<string> {
  const cached = titlePropertyCache.get(databaseId)
  if (cached) return cached

  try {
    const database: any = await notionRequest(`databases/${databaseId}`, {
      method: 'GET',
      apiKey,
    })

    const properties = database?.properties || {}
    const titleEntry = Object.entries(properties).find(
      ([, prop]: [string, any]) => prop?.type === 'title',
    )

    const titleName = titleEntry?.[0] || 'Name'
    titlePropertyCache.set(databaseId, titleName)
    logger.debug('Resolved Notion title property', { databaseId, titleName })
    return titleName
  }
  catch (error) {
    logger.warn('Failed to fetch Notion database schema — falling back to "Name"', {
      databaseId,
      error: (error as Error).message,
    })
    return 'Name'
  }
}

/**
 * Resolve the field-mapping entry for an AI field.
 *
 * Supports both the new format: { priority: { notionProperty, propertyType, valueMap } }
 * and the old format: { priorityProperty: 'Priority' } (converted to the new shape).
 */
function resolveFieldMappingEntry(
  fieldMapping: Record<string, any>,
  aiField: string,
): any {
  let mapping = fieldMapping[aiField]

  // If not found, try old format (aiField + 'Property')
  if (!mapping) {
    const oldKey = aiField + 'Property'
    const oldValue = fieldMapping[oldKey]
    if (typeof oldValue === 'string') {
      // Convert old format to new format, default to 'select' type
      mapping = {
        notionProperty: oldValue,
        propertyType: 'select', // Default assumption for legacy data
        valueMap: {},
      }
      logger.warn('Using legacy field mapping format', { aiField, oldKey, oldValue })
    }
  }

  return mapping
}

/**
 * Resolve an assignee value to a Notion user and set it as a 'people' property.
 *
 * The AI value is either a Notion UUID (used directly) or a source user ID that
 * must be mapped to a Notion user ID via userMappings. Logs and skips (no-op)
 * when no mapping can be resolved.
 */
function applyPeopleProperty(
  properties: Record<string, any>,
  notionProperty: string,
  value: any,
  propertyType: string,
  userMappings?: Map<string, string>,
): void {
  logger.debug('Assignee field - AI extracted value', { value })

  // Check if the value is already a Notion UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const isNotionUuid = typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

  let notionUserId: string | undefined

  if (isNotionUuid) {
    // AI returned Notion UUID directly (new flow with @Name (uuid) format)
    notionUserId = value
    logger.debug('AI returned Notion UUID directly', { notionUserId })
  } else {
    // Old flow: AI returned source user ID, need to map to Notion ID
    logger.debug('Value is not a UUID, attempting user mapping lookup', {
      value,
      userMappingsAvailable: userMappings ? userMappings.size : 0
    })

    if (!userMappings) {
      logger.warn('No user mappings Map provided for assignee field', { value })
      return
    }

    if (userMappings.size === 0) {
      logger.warn('User mappings Map is empty - no mappings to lookup')
    } else {
      logger.debug('Available mapping keys', { keys: Array.from(userMappings.keys()) })
    }

    const lookupKey = String(value)
    logger.debug('Looking up key', { lookupKey })
    notionUserId = userMappings.get(lookupKey)

    if (!notionUserId) {
      logger.warn('No user mapping found for assignee', { value, tip: 'Ensure sourceUserId in your mapping exactly matches this value' })
      return
    }

    logger.debug('Found mapping', { value, notionUserId })
  }

  const formattedProperty = formatNotionProperty(notionUserId, propertyType)
  if (formattedProperty) {
    properties[notionProperty] = formattedProperty
    logger.debug('Successfully set assignee to property', { notionProperty, notionUserId })
  } else {
    logger.warn('formatNotionProperty returned null for assignee', { notionUserId })
  }
}

/**
 * Build Notion properties from task data
 *
 * Strategy: Use the database's title property + apply field mappings for other properties.
 * Field mappings allow smart population of Notion database properties like Priority, Assignee, etc.
 *
 * @param task - Detected task with AI-generated fields
 * @param titlePropertyName - Name of the database's title property (varies per DB)
 * @param fieldMapping - Optional field mapping configuration from config.notionFieldMapping
 * @param userMappings - Optional map of source user IDs to Notion user IDs for assignee field
 */
async function buildTaskProperties(
  task: DetectedTask,
  titlePropertyName: string,
  fieldMapping?: Record<string, any>,
  userMappings?: Map<string, string>,
): Promise<Record<string, any>> {
  const properties: Record<string, any> = {
    [titlePropertyName]: {
      title: [
        {
          text: { content: task.title.substring(0, 2000) },
        },
      ],
    },
  }

  // If no field mapping provided, return basic properties
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) {
    return properties
  }

  // Import transformValue utility for select field value transformation
  const { transformValue } = await import('../utils/field-mapping')

  // Map AI fields to Notion properties based on field mapping
  const aiFieldValues: Record<string, any> = {
    priority: task.priority,
    type: task.type,
    assignee: task.assignee,
    dueDate: task.dueDate,
    tags: task.tags,
    domain: task.domain,
  }

  for (const [aiField, value] of Object.entries(aiFieldValues)) {
    // Skip if value is null/undefined
    if (value == null) {
      continue
    }

    // Check if this field has a mapping (supports new + legacy formats)
    const mapping = resolveFieldMappingEntry(fieldMapping, aiField)

    if (!mapping || !mapping.notionProperty) {
      continue
    }

    const { notionProperty: rawNotionProperty, propertyType, valueMap } = mapping

    // Extract property name (handle both string and object formats from USelectMenu)
    const notionProperty = typeof rawNotionProperty === 'string'
      ? rawNotionProperty
      : rawNotionProperty?.value || rawNotionProperty?.name || null

    if (!notionProperty) {
      logger.warn('Invalid notionProperty format', { aiField, rawNotionProperty })
      continue
    }

    logger.debug('Mapping field to Notion property', { aiField, notionProperty, propertyType })

    // Special handling for 'people' type (assignee field)
    if (propertyType === 'people') {
      applyPeopleProperty(properties, notionProperty, value, propertyType, userMappings)
      continue
    }

    // Handle value transformation for select/multi_select/status fields
    let transformedValue = value
    if (propertyType === 'select' || propertyType === 'multi_select' || propertyType === 'status') {
      // For these types, we need to transform the AI value to match Notion's options
      // The valueMap in the mapping config provides explicit transformations
      if (typeof value === 'string') {
        transformedValue = transformValue(value, undefined, valueMap) || value
      }
    }

    // Format and add the property
    const formattedProperty = formatNotionProperty(transformedValue, propertyType)
    if (formattedProperty) {
      properties[notionProperty] = formattedProperty
      logger.debug('Mapped field', { aiField, value, notionProperty, propertyType })
    }
  }

  return properties
}

/**
 * Notion limits toggle blocks to 100 children.
 */
const NOTION_MAX_TOGGLE_CHILDREN = 100

/**
 * Create a divider block
 */
function dividerBlock(): any {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  }
}

/**
 * AI Summary callout (concise, task-focused)
 */
function buildSummaryBlocks(aiSummary: AISummary): any[] {
  if (!aiSummary.summary) return []

  return [{
    object: 'block',
    type: 'callout',
    callout: {
      icon: { emoji: '🤖' },
      rich_text: [
        {
          type: 'text',
          text: { content: `AI Summary: ${aiSummary.summary}` },
        },
      ],
    },
  }]
}

/**
 * Task-specific action items as a heading + unchecked to-dos
 */
function buildActionItemBlocks(task: DetectedTask): any[] {
  if (!task.actionItems || task.actionItems.length === 0) return []

  const blocks: any[] = [{
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [
        {
          type: 'text',
          text: { content: '📋 This Task Requires' },
        },
      ],
    },
  }]

  for (const item of task.actionItems) {
    blocks.push({
      object: 'block',
      type: 'to_do',
      to_do: {
        checked: false,
        rich_text: [
          {
            type: 'text',
            text: { content: item },
          },
        ],
      },
    })
  }

  return blocks
}

/**
 * Discussion Context (collapsible) - Global insights from discussion
 */
function buildDiscussionContextBlocks(aiSummary: AISummary): any[] {
  if (!aiSummary.keyPoints || aiSummary.keyPoints.length === 0) return []

  return [{
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [
        {
          type: 'text',
          text: { content: '🔍 Discussion Context' },
          annotations: { bold: true },
        },
      ],
      children: aiSummary.keyPoints.slice(0, NOTION_MAX_TOGGLE_CHILDREN).map(point => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            {
              type: 'text',
              text: { content: point },
            },
          ],
        },
      })),
    },
  }]
}

/**
 * Participants paragraph with @mentions (if userMentions provided)
 */
function buildParticipantBlocks(
  thread: DiscussionThread,
  userMentions?: Map<string, string>,
): any[] {
  if (thread.participants.length === 0) return []

  logger.debug('Building participants section', {
    participantCount: thread.participants.length,
    userMentionsAvailable: userMentions ? userMentions.size : 0
  })

  const participantRichText: any[] = [
    {
      type: 'text',
      text: { content: '👥 Participants: ' },
    },
  ]

  // Build rich text with @mentions for each participant
  for (let i = 0; i < thread.participants.length; i++) {
    const participantId = thread.participants[i]
    if (!participantId) continue

    // Try to get Notion user ID for mention
    const notionUserId = userMentions?.get(participantId)

    if (notionUserId) {
      // Add proper @mention
      logger.debug('Creating @mention for participant', { participantId, notionUserId })
      const mentionObject = {
        type: 'mention',
        mention: {
          type: 'user',
          user: {
            object: 'user', // Required by Notion API
            id: notionUserId,
          },
        },
      }
      logger.debug('Mention object structure', { mentionObject })
      participantRichText.push(mentionObject)
    }
    else {
      // Fallback to plain text if no mapping
      logger.debug('No mention mapping for participant, using plain text', { participantId })
      participantRichText.push({
        type: 'text',
        text: { content: `@${participantId}` },
      })
    }

    // Add separator between participants (except for last one)
    if (i < thread.participants.length - 1) {
      participantRichText.push({
        type: 'text',
        text: { content: ', ' },
      })
    }
  }

  logger.debug('Complete participantRichText array', { participantRichText })

  return [{
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: participantRichText,
    },
  }]
}

/**
 * Thread content summary (task-specific description): heading + description paragraph
 */
function buildThreadContentBlocks(task: DetectedTask): any[] {
  return [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Thread Content' },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: task.description.substring(0, 2000) },
          },
        ],
      },
    },
  ]
}

/**
 * Bold author line ("@Name:"), linked to the source message when a URL is available
 */
function buildAuthorLineBlock(authorLabel: string, messageUrl: string | null): any {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: {
            content: `${authorLabel}:`,
            link: messageUrl ? { url: messageUrl } : undefined,
          },
          annotations: { bold: true, color: messageUrl ? 'blue' : 'default' },
        },
      ],
    },
  }
}

/**
 * Message body paragraph with mentions/links parsed (capped at Notion's 2000-char limit)
 */
function buildMessageBodyBlock(content: string, messageUrl: string | null): any {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: parseContentWithMentionsAndLinks(
        content.substring(0, 2000),
        messageUrl || undefined,
      ),
    },
  }
}

/**
 * Flatten the root message + replies into paragraph blocks ("—" separator before each reply)
 */
function buildThreadMessageBlocks(
  thread: DiscussionThread,
  sourceMetadata?: SourceMetadata,
): any[] {
  const threadMessages: any[] = []

  // Add root message
  const rootAuthorName = thread.rootMessage.authorName
    ? `@${thread.rootMessage.authorName}`
    : thread.rootMessage.authorHandle
  const rootMessageUrl = buildMessageUrl(thread.rootMessage.id, sourceMetadata)

  threadMessages.push(buildAuthorLineBlock(rootAuthorName, rootMessageUrl))
  threadMessages.push(buildMessageBodyBlock(thread.rootMessage.content, rootMessageUrl))

  // Add replies
  for (const reply of thread.replies) {
    const replyAuthorName = reply.authorName
      ? `@${reply.authorName}`
      : reply.authorHandle
    const replyMessageUrl = buildMessageUrl(reply.id, sourceMetadata)

    threadMessages.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: '—' },
          },
        ],
      },
    })
    threadMessages.push(buildAuthorLineBlock(replyAuthorName, replyMessageUrl))
    threadMessages.push(buildMessageBodyBlock(reply.content, replyMessageUrl))
  }

  return threadMessages
}

/**
 * Notion limits toggle children to 100. Truncate and add a note if needed.
 */
function truncateToggleChildren(threadMessages: any[]): any[] {
  return threadMessages.length > NOTION_MAX_TOGGLE_CHILDREN
    ? [
        ...threadMessages.slice(0, NOTION_MAX_TOGGLE_CHILDREN - 1),
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `… ${threadMessages.length - NOTION_MAX_TOGGLE_CHILDREN + 1} more messages truncated (Notion limit: ${NOTION_MAX_TOGGLE_CHILDREN})` },
              annotations: { italic: true, color: 'gray' },
            }],
          },
        },
      ]
    : threadMessages
}

/**
 * Full Discussion Thread (collapsible)
 */
function buildFullThreadToggleBlock(
  thread: DiscussionThread,
  sourceMetadata?: SourceMetadata,
): any {
  const truncatedMessages = truncateToggleChildren(buildThreadMessageBlocks(thread, sourceMetadata))

  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [
        {
          type: 'text',
          text: { content: '💬 Full Discussion Thread' },
          annotations: { bold: true },
        },
      ],
      children: truncatedMessages,
    },
  }
}

/**
 * Create a metadata bulleted list item with optional Notion mention
 */
function createMetadataItem(label: string, value: string, notionUserId?: string): any {
  const richText: any[] = [
    {
      type: 'text',
      text: { content: `${label}: ` },
    },
  ]

  if (notionUserId) {
    // Add Notion user mention
    richText.push({
      type: 'mention',
      mention: {
        type: 'user',
        user: {
          object: 'user',
          id: notionUserId,
        },
      },
    })
  } else {
    // Just add plain text
    richText.push({
      type: 'text',
      text: { content: value },
    })
  }

  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText },
  }
}

/**
 * Metadata section (generic for any source): heading + bulleted metadata items
 */
function buildMetadataBlocks(
  task: DetectedTask,
  thread: DiscussionThread,
  aiSummary: AISummary,
  config: NotionTaskConfig,
  userMentions?: Map<string, string>,
): any[] {
  const blocks: any[] = [{
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Metadata' },
        },
      ],
    },
  }]

  // Get Notion user ID for the message author
  const authorHandle = thread.rootMessage.authorHandle
  const authorNotionId = userMentions?.get(authorHandle)

  logger.debug('Metadata - Author info', {
    authorHandle,
    authorNotionId: authorNotionId || 'not found'
  })
  if (userMentions) {
    logger.debug('Metadata - Available user mentions', { mentions: Array.from(userMentions.keys()) })
  }

  // Basic metadata items
  blocks.push(createMetadataItem('Source', config.sourceType))
  blocks.push(createMetadataItem('Thread ID', thread.id))
  blocks.push(createMetadataItem('Thread Size', `${thread.replies.length + 1} messages`))
  blocks.push(createMetadataItem('Created By', thread.rootMessage.authorHandle, authorNotionId))
  blocks.push(createMetadataItem('Priority', task.priority || 'medium'))
  blocks.push(createMetadataItem('Sentiment', aiSummary.sentiment || 'neutral'))
  blocks.push(createMetadataItem('Confidence', `${Math.round((aiSummary.confidence || 0) * 100)}%`))
  blocks.push(createMetadataItem('Timestamp', new Date().toLocaleString()))

  // Assignee with Notion mention if available
  if (task.assignee) {
    // Check if assignee is a Notion UUID
    const isNotionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.assignee)
    const assigneeNotionId = isNotionUuid ? task.assignee : userMentions?.get(task.assignee)
    blocks.push(createMetadataItem('Assignee', task.assignee, assigneeNotionId))
  }

  // Tags
  if (task.tags && task.tags.length > 0) {
    blocks.push(createMetadataItem('Tags', task.tags.join(', ')))
  }

  return blocks
}

/**
 * Deep link back to source (divider + link paragraph), when config.sourceUrl is set
 */
function buildSourceLinkBlocks(config: NotionTaskConfig): any[] {
  if (!config.sourceUrl) return []

  return [
    dividerBlock(),
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: '🔗 ' },
          },
          {
            type: 'text',
            text: {
              content: `View Discussion in ${config.sourceType}`,
              link: { url: config.sourceUrl },
            },
            annotations: {
              bold: true,
              color: 'blue',
            },
          },
        ],
      },
    },
  ]
}

/**
 * Build rich content blocks for Notion page
 *
 * Generic structure that works for any source type:
 * - AI Summary callout
 * - Action items as checkboxes
 * - Participants list with @mentions (if userMentions provided)
 * - Thread content
 * - Generic metadata section
 * - Deep link back to source
 *
 * @param userMentions - Optional map of source user IDs to Notion user IDs for @mentions
 * @param sourceMetadata - Optional metadata for building source platform links
 */
function buildTaskContent(
  task: DetectedTask,
  thread: DiscussionThread,
  aiSummary: AISummary,
  config: NotionTaskConfig,
  userMentions?: Map<string, string>,
  sourceMetadata?: SourceMetadata,
): any[] {
  const blocks: any[] = [
    ...buildSummaryBlocks(aiSummary),
    ...buildActionItemBlocks(task),
    ...buildDiscussionContextBlocks(aiSummary),
    ...buildParticipantBlocks(thread, userMentions),
    dividerBlock(),
    ...buildThreadContentBlocks(task),
    buildFullThreadToggleBlock(thread, sourceMetadata),
    dividerBlock(),
    ...buildMetadataBlocks(task, thread, aiSummary, config, userMentions),
    ...buildSourceLinkBlocks(config),
  ]

  logger.debug('Complete blocks array (children)', { blocksCount: blocks.length })

  return blocks
}

/**
 * Create a single task in Notion
 *
 * Uses retry logic for transient failures.
 *
 * @param userMentions - Optional map of source user IDs to Notion user IDs for @mentions
 * @param sourceMetadata - Optional metadata for building source platform links
 */
export async function createNotionTask(
  task: DetectedTask,
  thread: DiscussionThread,
  aiSummary: AISummary,
  config: NotionTaskConfig,
  userMentions?: Map<string, string>,
  fieldMapping?: Record<string, any>,
  userMappings?: Map<string, string>,
  sourceMetadata?: SourceMetadata,
): Promise<NotionTaskResult> {
  logger.info('Creating Notion task', {
    title: task.title,
    databaseId: config.databaseId,
    sourceType: config.sourceType,
  })

  const apiKey = getNotionApiKey(config.apiKey)
  const titlePropertyName = await getTitlePropertyName(apiKey, config.databaseId)
  const properties = await buildTaskProperties(task, titlePropertyName, fieldMapping, userMappings)
  const children = buildTaskContent(task, thread, aiSummary, config, userMentions, sourceMetadata)

  const startTime = Date.now()

  const page = await retryWithBackoff(
    () =>
      notionRequest('pages', {
        method: 'POST',
        apiKey,
        body: {
          parent: { database_id: config.databaseId },
          properties,
          children,
        },
      }),
    {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      timeout: 15000, // 15 second timeout to prevent hanging
    },
  )

  const duration = Date.now() - startTime

  logger.info('Task created successfully', { taskId: page.id, duration })

  useNitroApp().hooks.callHook('crouton:operation', {
    type: 'notion:page:created',
    source: 'crouton-triage',
    metadata: {
      pageId: page.id as string,
      duration,
      sourceType: config.sourceType,
    },
  }).catch(() => {})

  return {
    id: page.id,
    title: task.title,
    url: page.url,
    createdAt: new Date(),
  }
}

/**
 * Create multiple tasks in Notion with rate limiting
 *
 * Processes tasks sequentially with 200ms delays to respect
 * Notion's 3 requests/second rate limit.
 *
 * Fails fast - stops on first error to avoid partial imports.
 *
 * @param userMentions - Optional map of source user IDs to Notion user IDs for @mentions
 * @param fieldMapping - Optional field mapping configuration from config.notionFieldMapping
 * @param userMappings - Optional map of source user IDs to Notion user IDs for assignee field
 * @param sourceMetadata - Optional metadata for building source platform links
 */
export async function createNotionTasks(
  tasks: DetectedTask[],
  thread: DiscussionThread,
  aiSummary: AISummary,
  config: NotionTaskConfig,
  userMentions?: Map<string, string>,
  fieldMapping?: Record<string, any>,
  userMappings?: Map<string, string>,
  sourceMetadata?: SourceMetadata,
): Promise<NotionTaskResult[]> {
  logger.info('Creating batch of tasks', {
    taskCount: tasks.length,
    titles: tasks.map(t => t.title),
  })

  const results: NotionTaskResult[] = []
  const startTime = Date.now()

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    if (!task) continue

    try {
      const result = await createNotionTask(task, thread, aiSummary, config, userMentions, fieldMapping, userMappings, sourceMetadata)
      results.push(result)

      logger.info('Created task in batch', {
        index: i + 1,
        total: tasks.length,
        taskId: result.id,
      })

      // Rate limiting: 200ms delay between requests (respects 3 req/sec limit)
      if (i < tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
    catch (error) {
      logger.error('Failed to create task', error, {
        title: task?.title,
      })
      throw error // Fail fast on errors
    }
  }

  const duration = Date.now() - startTime

  logger.info('Successfully created tasks', {
    count: results.length,
    duration,
  })

  return results
}

/**
 * Result of Notion connection test
 */
export interface NotionConnectionTestResult {
  connected: boolean
  details?: {
    databaseId: string
    title: string
    url: string
  }
  error?: string
}

/**
 * Test Notion connection and database access
 *
 * Enhanced version for Admin UI validation (Phase 5.5).
 * Verifies:
 * - API key is valid
 * - Database exists and is accessible
 * - Returns database details (title, URL) on success
 *
 * @param config - Configuration with API key and database ID
 * @returns Test result with connection status and details/error
 */
export async function testNotionConnection(config: {
  apiKey: string
  databaseId: string
}): Promise<NotionConnectionTestResult> {
  try {
    const apiKey = getNotionApiKey(config.apiKey)

    const database: any = await retryWithBackoff(
      () => notionRequest(`databases/${config.databaseId}`, {
        method: 'GET',
        apiKey,
      }),
      {
        maxAttempts: 2,
        baseDelay: 500,
        timeout: 10000, // 10 second timeout
      },
    )

    // Extract database title (can be in different formats)
    let title = 'Untitled Database'
    if (database.title && Array.isArray(database.title) && database.title.length > 0) {
      title = database.title[0]?.plain_text || title
    }

    logger.info('Connection test successful', {
      databaseId: config.databaseId,
      title,
    })

    return {
      connected: true,
      details: {
        databaseId: config.databaseId,
        title,
        url: database.url || `https://notion.so/${config.databaseId.replace(/-/g, '')}`,
      },
    }
  }
  catch (error) {
    logger.error('Connection test failed', error)

    const errorMessage = (error as any).body?.message
      || (error as Error).message
      || 'Unknown error'

    return {
      connected: false,
      error: errorMessage,
    }
  }
}

/**
 * Format a value as a Notion property based on property type
 *
 * Adapted from figno's notionIntegration.ts but kept generic.
 * Used for future property mapping support (Phase 5+).
 */
export function formatNotionProperty(
  value: any,
  propertyType: string,
): any {
  switch (propertyType) {
    case 'title':
      return {
        title: [
          {
            text: { content: String(value).substring(0, 2000) },
          },
        ],
      }

    case 'rich_text':
      return {
        rich_text: [
          {
            text: { content: String(value).substring(0, 2000) },
          },
        ],
      }

    case 'number':
      return {
        number: Number(value) || 0,
      }

    case 'select':
      return {
        select: { name: String(value) },
      }

    case 'multi_select': {
      const values = Array.isArray(value) ? value : [value]
      return {
        multi_select: values.map(v => ({ name: String(v) })),
      }
    }

    case 'date':
      return {
        date: {
          start: value instanceof Date ? value.toISOString() : String(value),
        },
      }

    case 'checkbox':
      return {
        checkbox: Boolean(value),
      }

    case 'url':
      return {
        url: String(value),
      }

    case 'email':
      return {
        email: String(value),
      }

    case 'phone_number':
      return {
        phone_number: String(value),
      }

    case 'people': {
      // Handle array of user IDs for people fields
      const userIds = Array.isArray(value) ? value : [value]
      // Filter out null/undefined values
      const validIds = userIds.filter(id => id != null)

      if (validIds.length === 0) {
        return null
      }

      return {
        people: validIds.map(id => ({
          object: 'user',
          id: String(id),
        })),
      }
    }

    default:
      // Fallback to rich_text for unknown types
      return {
        rich_text: [
          {
            text: { content: String(value).substring(0, 2000) },
          },
        ],
      }
  }
}
