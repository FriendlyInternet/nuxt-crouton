/**
 * Notion Discussion Source Adapter
 *
 * Implements the DiscussionSourceAdapter interface for Notion comments.
 * Handles:
 * - Webhook-based parsing for comment.created events
 * - Fetching comment threads from Notion API
 * - Posting replies to Notion comment threads
 * - Configuration validation and testing
 *
 * Note: Notion doesn't support reactions on comments, so updateStatus
 * is a no-op that always returns true.
 *
 * @see https://developers.notion.com/reference/comment-object
 * @see https://developers.notion.com/reference/create-a-comment
 */

import type {
  ParsedDiscussion,
  DiscussionThread,
  DiscussionStatus,
  AdapterConfig,
  ValidationResult,
  ThreadMessage,
} from '../../app/types'
import { AdapterError, type DiscussionSourceAdapter } from './base'
import { logger } from '../utils/logger'

/**
 * Notion API base URL
 */
const NOTION_API_BASE = 'https://api.notion.com/v1'

/**
 * Notion API version header value
 */
const NOTION_API_VERSION = '2022-06-28'

/**
 * Default trigger keyword for activating Triage
 * Note: For Notion input, we check for the word without @ prefix
 * since Notion doesn't use @ mentions the same way as Slack/Figma
 */
const DEFAULT_TRIGGER_KEYWORD = 'triage'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Notion rich text object
 */
interface NotionRichText {
  type: string
  text?: { content: string; link?: { url: string } | null }
  plain_text: string
  annotations?: {
    bold: boolean
    italic: boolean
    strikethrough: boolean
    underline: boolean
    code: boolean
    color: string
  }
  href?: string | null
}

/**
 * Notion comment object from API
 */
interface NotionComment {
  id: string
  parent: {
    type: 'page_id' | 'block_id'
    page_id?: string
    block_id?: string
  }
  discussion_id: string
  rich_text: NotionRichText[]
  created_time: string
  created_by: {
    id: string
    object: string
  }
}

/**
 * Notion comments list response
 */
interface NotionCommentsListResponse {
  object: 'list'
  results: NotionComment[]
  has_more: boolean
  next_cursor: string | null
}

/**
 * Notion user object from API
 */
interface NotionUser {
  id: string
  object: 'user'
  type?: 'person' | 'bot'
  name?: string
  avatar_url?: string | null
  person?: {
    email?: string
  }
}

/**
 * Notion webhook payload for comment.created events
 */
interface NotionWebhookPayload {
  type: string
  data: {
    id: string
    parent: {
      type: 'page_id' | 'block_id'
      id?: string
      page_id?: string
      block_id?: string
    }
    discussion_id: string
    page_id?: string
  }
  entity: {
    id: string
    type: string
  }
  timestamp: string
  workspace_id?: string
  integration_id?: string
}

/**
 * Notion API error response
 */
interface NotionErrorResponse {
  object: 'error'
  status: number
  code: string
  message: string
}

// ============================================================================
// API HELPER FUNCTIONS
// ============================================================================

/**
 * Fetch a single comment by ID
 *
 * @param commentId - The comment UUID
 * @param token - Notion API token
 * @returns The comment object or null if not found
 */
async function fetchComment(
  commentId: string,
  token: string
): Promise<NotionComment | null> {
  try {
    const response = await $fetch<NotionComment>(
      `${NOTION_API_BASE}/comments/${commentId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      }
    )
    return response
  } catch (error: any) {
    // Log detailed error info for debugging
    const errorData = error.data || error.response?._data || {}
    logger.error('[Notion] Failed to fetch comment', error, {
      commentId,
      status: error.statusCode || error.status,
      notionCode: errorData.code,
      notionMessage: errorData.message,
      tokenPrefix: token ? `${token.substring(0, 10)}...` : 'missing',
    })

    if (error.statusCode === 404) {
      return null
    }
    if (error.statusCode === 403) {
      logger.error('[Notion] 403 Forbidden - Check that:', null, {
        hint1: 'Integration has "Read comments" capability enabled',
        hint2: 'Integration is connected to the page where comment was made',
        hint3: 'Using the correct integration token',
      })
    }
    throw error
  }
}

/**
 * Fetch all comments in a thread by page/block ID and discussion ID
 *
 * @param blockId - The page or block ID where comments are located
 * @param discussionId - The discussion thread ID
 * @param token - Notion API token
 * @returns Array of comments in the thread, sorted by creation time
 */
async function fetchCommentThread(
  blockId: string,
  discussionId: string,
  token: string
): Promise<NotionComment[]> {
  const allComments: NotionComment[] = []
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    const params = new URLSearchParams({
      block_id: blockId,
    })
    if (cursor) {
      params.set('start_cursor', cursor)
    }

    const response = await $fetch<NotionCommentsListResponse>(
      `${NOTION_API_BASE}/comments?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      }
    )

    // Filter comments by discussion_id
    const threadComments = response.results.filter(
      (c) => c.discussion_id === discussionId
    )
    allComments.push(...threadComments)

    hasMore = response.has_more
    cursor = response.next_cursor
  }

  // Sort by creation time (oldest first)
  allComments.sort(
    (a, b) =>
      new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
  )

  return allComments
}

/**
 * Post a comment reply to a discussion thread
 *
 * @param discussionId - The discussion thread ID to reply to
 * @param content - The reply message content
 * @param token - Notion API token
 * @returns The created comment or null if failed
 */
async function postComment(
  discussionId: string,
  content: string,
  token: string
): Promise<NotionComment | null> {
  try {
    const response = await $fetch<NotionComment>(
      `${NOTION_API_BASE}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: {
          discussion_id: discussionId,
          rich_text: [
            {
              type: 'text',
              text: {
                content,
              },
            },
          ],
        },
      }
    )
    return response
  } catch (error) {
    logger.error('Failed to post Notion comment', error)
    return null
  }
}

/**
 * Fetch page/block content from Notion to provide AI context
 *
 * @param blockId - The page or block ID to fetch content from
 * @param token - Notion API token
 * @param maxLength - Maximum content length to return (default: 5000 chars)
 * @returns Plain text representation of the page content
 */
async function fetchPageContent(
  blockId: string,
  token: string,
  maxLength: number = 5000,
): Promise<string> {
  let content = ''
  let cursor: string | null = null

  try {
    // Fetch blocks with pagination (max 2 pages to limit API calls)
    let pagesFetched = 0
    const maxPages = 2

    while (content.length < maxLength && pagesFetched < maxPages) {
      const url: string = cursor
        ? `${NOTION_API_BASE}/blocks/${blockId}/children?start_cursor=${cursor}`
        : `${NOTION_API_BASE}/blocks/${blockId}/children`

      const response: {
        results: Array<{ type: string; [key: string]: any }>
        has_more: boolean
        next_cursor: string | null
      } = await $fetch<{
        results: Array<{
          type: string
          [key: string]: any
        }>
        has_more: boolean
        next_cursor: string | null
      }>(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      })

      // Extract text from common block types
      for (const block of response.results) {
        const blockContent = extractBlockText(block)
        if (blockContent) {
          content += blockContent + '\n'
        }
        if (content.length >= maxLength) break
      }

      if (!response.has_more) break
      cursor = response.next_cursor
      pagesFetched++
    }

    // Truncate to max length at word boundary
    if (content.length > maxLength) {
      const truncated = content.substring(0, maxLength)
      const lastSpace = truncated.lastIndexOf(' ')
      content = lastSpace > 0 ? truncated.substring(0, lastSpace) + '...' : truncated
    }

    return content.trim()
  } catch (error) {
    logger.warn('Failed to fetch page content for AI context', { blockId, error: (error as Error).message })
    return '' // Graceful fallback - AI will work without context
  }
}

/**
 * Extract plain text from a Notion block
 */
function extractBlockText(block: { type: string; [key: string]: any }): string {
  const blockData = block[block.type]
  if (!blockData) return ''

  // Handle blocks with rich_text array
  if (blockData.rich_text && Array.isArray(blockData.rich_text)) {
    const text = blockData.rich_text.map((rt: NotionRichText) => rt.plain_text).join('')

    // Add formatting based on block type
    switch (block.type) {
      case 'heading_1':
        return `# ${text}`
      case 'heading_2':
        return `## ${text}`
      case 'heading_3':
        return `### ${text}`
      case 'bulleted_list_item':
        return `• ${text}`
      case 'numbered_list_item':
        return `- ${text}`
      case 'to_do':
        const checked = blockData.checked ? '☑' : '☐'
        return `${checked} ${text}`
      case 'code':
        return `\`\`\`\n${text}\n\`\`\``
      case 'quote':
        return `> ${text}`
      default:
        return text
    }
  }

  // Handle special block types
  if (block.type === 'divider') return '---'
  if (block.type === 'equation' && blockData.expression) return blockData.expression

  return ''
}

/**
 * Check if a trigger keyword exists in rich text content
 *
 * @param richText - Array of rich text objects
 * @param keyword - The trigger keyword to search for (default: @triage)
 * @returns true if the keyword is found in the content
 */
function checkForTrigger(
  richText: NotionRichText[],
  keyword: string = DEFAULT_TRIGGER_KEYWORD
): boolean {
  if (!richText || richText.length === 0) {
    return false
  }

  // Combine all plain text content
  const fullText = richText.map((rt) => rt.plain_text).join('')

  // Case-insensitive search for the keyword
  return fullText.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * Extract plain text content from rich text array
 *
 * @param richText - Array of rich text objects
 * @returns Combined plain text string
 */
function extractPlainText(richText: NotionRichText[]): string {
  if (!richText || richText.length === 0) {
    return ''
  }
  return richText.map((rt) => rt.plain_text).join('')
}

/**
 * Strip trigger keyword from text content
 * Handles: "legoman text", "@legoman text", "legoman: text"
 * Does NOT strip if part of a word: "legomanize" stays unchanged
 *
 * @param text - The text to strip the trigger keyword from
 * @param triggerKeyword - The trigger keyword to strip
 * @returns Text with trigger keyword removed
 */
function stripTriggerKeyword(text: string, triggerKeyword: string): string {
  if (!text || !triggerKeyword) return text
  const escaped = triggerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Word boundary aware: optional @, keyword, optional colon, followed by space or end
  const pattern = new RegExp(`@?${escaped}:?(?:\\s+|$)`, 'gi')
  return text.replace(pattern, '').trim()
}

/**
 * Get the parent page ID from a comment
 *
 * @param comment - Notion comment object
 * @returns The page ID or block ID
 */
function getParentId(comment: NotionComment): string {
  return comment.parent.page_id || comment.parent.block_id || ''
}

// ============================================================================
// NOTION ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Notion Adapter Implementation
 */
export class NotionAdapter implements DiscussionSourceAdapter {
  readonly sourceType = 'notion'

  /**
   * Parse incoming Notion webhook payload
   *
   * The webhook payload should contain:
   * - comment.created event type
   * - Comment ID, discussion ID, and parent (page/block) ID
   * - Workspace ID for team resolution
   *
   * Note: This method fetches the full comment content via API since
   * the webhook only contains IDs, not the actual content.
   *
   * @param payload - Raw webhook payload
   * @param config - Optional source config for API access
   * @throws AdapterError if payload cannot be parsed or comment fetch fails
   */
  async parseIncoming(
    payload: any,
    config?: AdapterConfig
  ): Promise<ParsedDiscussion> {
    try {
      const webhookPayload = payload as NotionWebhookPayload

      // Validate event type
      if (webhookPayload.type !== 'comment.created') {
        throw new AdapterError(
          `Unsupported event type: ${webhookPayload.type} (only "comment.created" is supported)`,
          {
            sourceType: this.sourceType,
            retryable: false,
          }
        )
      }

      // Extract IDs from webhook payload
      // Notion webhook structure (2024+):
      // - commentId is in entity.id
      // - parentId is in data.parent.id (not page_id/block_id)
      // - discussionId must be fetched from the comment via API
      const commentId = webhookPayload.entity?.id || webhookPayload.data?.id
      const parentId =
        webhookPayload.data?.parent?.id ||
        webhookPayload.data?.parent?.page_id ||
        webhookPayload.data?.parent?.block_id ||
        webhookPayload.data?.page_id

      if (!commentId || !parentId) {
        throw new AdapterError(
          'Missing required IDs in webhook payload (commentId or parentId)',
          {
            sourceType: this.sourceType,
            retryable: false,
          }
        )
      }

      // Fetch the full comment to get discussionId and content
      let content = ''
      let authorId = ''
      let discussionId = webhookPayload.data?.discussion_id || ''
      let createdTime = webhookPayload.timestamp

      if (config?.apiToken) {
        const comment = await fetchComment(commentId, config.apiToken)
        if (comment) {
          const rawContent = extractPlainText(comment.rich_text)
          // Strip trigger keyword from content before processing
          const triggerKeyword = config.sourceMetadata?.triggerKeyword || DEFAULT_TRIGGER_KEYWORD
          content = stripTriggerKeyword(rawContent, triggerKeyword)
          authorId = comment.created_by.id
          createdTime = comment.created_time
          // Get discussionId from fetched comment if not in payload
          discussionId = discussionId || comment.discussion_id
        }
      }

      // If we still don't have discussionId, use commentId as fallback
      if (!discussionId) {
        discussionId = commentId
        logger.warn('[NotionAdapter] No discussionId found, using commentId as fallback', {
          commentId,
          parentId,
        })
      }

      // Build source thread ID (format: page_id:discussion_id)
      const sourceThreadId = `${parentId}:${discussionId}`

      // Build source URL (direct link to Notion page)
      // Note: Notion page URLs use the format notion.so/<page_id>
      const cleanPageId = parentId.replace(/-/g, '')
      const sourceUrl = `https://notion.so/${cleanPageId}`

      // Resolve team ID from workspace ID
      const teamId = webhookPayload.workspace_id || 'default'

      return {
        sourceType: this.sourceType,
        sourceThreadId,
        sourceUrl,
        teamId,
        authorHandle: authorId,
        title: this.extractTitle(content),
        content,
        participants: authorId ? [authorId] : [],
        timestamp: new Date(createdTime),
        metadata: {
          commentId,
          discussionId,
          parentId,
          parentType: webhookPayload.data?.parent?.type || 'page',
          workspaceId: webhookPayload.workspace_id,
          entityId: webhookPayload.entity?.id,
          entityType: webhookPayload.entity?.type,
        },
      }
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error
      }
      throw new AdapterError(
        `Failed to parse Notion webhook: ${(error as Error).message}`,
        {
          sourceType: this.sourceType,
          retryable: false,
        }
      )
    }
  }

  /**
   * Fetch complete comment thread from Notion API
   *
   * @param threadId - Format: "page_id:discussion_id"
   * @param config - Source configuration with API token
   */
  async fetchThread(
    threadId: string,
    config: AdapterConfig
  ): Promise<DiscussionThread> {
    try {
      // Parse threadId format
      const [pageId, discussionId] = threadId.split(':')

      if (!pageId || !discussionId) {
        throw new AdapterError(
          'Invalid thread ID format, expected "page_id:discussion_id"',
          {
            sourceType: this.sourceType,
            threadId,
            retryable: false,
          }
        )
      }

      // Fetch all comments in the thread
      const comments = await fetchCommentThread(
        pageId,
        discussionId,
        config.apiToken!
      )

      if (comments.length === 0) {
        throw new AdapterError('No comments found in thread', {
          sourceType: this.sourceType,
          threadId,
          statusCode: 404,
          retryable: false,
        })
      }

      // First comment is the root (oldest)
      const rootComment = comments[0]!
      const replies = comments.slice(1)

      // Extract participants
      const participantSet = new Set<string>()
      participantSet.add(rootComment.created_by.id)
      replies.forEach((comment) => {
        participantSet.add(comment.created_by.id)
      })

      // Fetch page content for AI context (non-blocking, graceful failure)
      let pageContent = ''
      if (config.apiToken) {
        pageContent = await fetchPageContent(pageId, config.apiToken!)
        if (pageContent) {
          logger.debug('Fetched page content for AI context', {
            pageId,
            contentLength: pageContent.length,
          })
        }
      }

      // Build thread
      const thread = {
        id: discussionId,
        rootMessage: this.convertToThreadMessage(rootComment),
        replies: replies.map((c) => this.convertToThreadMessage(c)),
        participants: Array.from(participantSet),
        metadata: {
          pageId,
          discussionId,
          commentCount: comments.length,
          pageContent, // Page content for AI context
        },
      }

      // Strip trigger keyword from all message content before AI processing
      const triggerKeyword = config.sourceMetadata?.triggerKeyword || DEFAULT_TRIGGER_KEYWORD
      thread.rootMessage.content = stripTriggerKeyword(thread.rootMessage.content, triggerKeyword)
      thread.replies.forEach((reply) => {
        reply.content = stripTriggerKeyword(reply.content, triggerKeyword)
      })

      return thread
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error
      }
      throw new AdapterError(
        `Failed to fetch Notion thread: ${(error as Error).message}`,
        {
          sourceType: this.sourceType,
          threadId,
          retryable: true,
        }
      )
    }
  }

  /**
   * Post a reply to a Notion comment thread
   *
   * @param threadId - Format: "page_id:discussion_id"
   * @param message - Reply message (plain text)
   * @param config - Source configuration with API token
   */
  async postReply(
    threadId: string,
    message: string,
    config: AdapterConfig
  ): Promise<boolean> {
    try {
      const [_pageId, discussionId] = threadId.split(':')

      if (!discussionId) {
        logger.warn('No discussionId provided, cannot post reply')
        return false
      }

      const comment = await postComment(discussionId, message, config.apiToken!)
      return comment !== null
    } catch (error) {
      logger.error('Failed to post Notion reply', error)
      return false
    }
  }

  /**
   * Update status indicator
   *
   * Notion doesn't support reactions on comments, so this is a no-op.
   * Always returns true to indicate "success" (no action needed).
   */
  async updateStatus(
    _threadId: string,
    _status: DiscussionStatus,
    _config: AdapterConfig
  ): Promise<boolean> {
    // Notion doesn't support reactions on comments
    // This is intentionally a no-op
    logger.debug('Notion updateStatus is a no-op (reactions not supported)')
    return true
  }

  /**
   * Validate Notion source configuration
   *
   * Checks:
   * - API token (notionToken) is present
   * - Token format appears valid (starts with "secret_" or "ntn_")
   */
  async validateConfig(config: AdapterConfig): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check API token
    // Note: For Notion input, we use notionToken (the integration token)
    // since apiToken might be used for the output Notion database
    const token = config.apiToken || (config as any).notionToken

    if (!token || token.trim() === '') {
      errors.push('Notion API token is required')
    } else if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
      warnings.push(
        'Notion API token should start with "secret_" or "ntn_" (internal integration token format)'
      )
    }

    // Check source type matches
    if (config.sourceType !== this.sourceType) {
      errors.push(
        `Source type mismatch: expected '${this.sourceType}', got '${config.sourceType}'`
      )
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Test connection to Notion API
   *
   * Uses GET /users/me endpoint to verify the token is valid.
   */
  async testConnection(config: AdapterConfig): Promise<boolean> {
    try {
      const token = config.apiToken || (config as any).notionToken

      if (!token) {
        return false
      }

      const response = await $fetch<NotionUser>(
        `${NOTION_API_BASE}/users/me`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': NOTION_API_VERSION,
          },
        }
      )

      // If we get a user object back, the connection is successful
      return response.object === 'user'
    } catch (error) {
      logger.error('Failed to test Notion connection', error)
      return false
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Extract a title from comment content
   * Uses first line or first 50 characters
   */
  private extractTitle(text: string): string {
    if (!text) {
      return 'Notion Comment'
    }

    // Get first line
    const firstLine = (text.split('\n')[0] ?? '').trim()

    // Truncate to 50 chars if needed
    if (firstLine.length > 50) {
      return firstLine.substring(0, 47) + '...'
    }

    return firstLine || 'Notion Comment'
  }

  /**
   * Convert Notion comment to ThreadMessage format
   */
  private convertToThreadMessage(comment: NotionComment): ThreadMessage {
    return {
      id: comment.id,
      authorHandle: comment.created_by.id,
      content: extractPlainText(comment.rich_text),
      timestamp: new Date(comment.created_time),
    }
  }
}

// ============================================================================
// FACTORY & EXPORTS
// ============================================================================

/**
 * Create a new Notion adapter instance
 */
export function createNotionAdapter(): DiscussionSourceAdapter {
  return new NotionAdapter()
}

/**
 * Export helper functions for use in webhook handler
 */
export {
  fetchComment,
  fetchCommentThread,
  postComment,
  checkForTrigger,
  extractPlainText,
  stripTriggerKeyword,
  DEFAULT_TRIGGER_KEYWORD,
}

/**
 * Export types for external use
 */
export type {
  NotionComment,
  NotionRichText,
  NotionWebhookPayload,
  NotionUser,
}
