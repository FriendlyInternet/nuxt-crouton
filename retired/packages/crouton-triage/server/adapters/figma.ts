/**
 * Figma Discussion Source Adapter
 *
 * Implements the DiscussionSourceAdapter interface for Figma comments.
 * Handles:
 * - Email-based webhook parsing (via Mailgun)
 * - Fetching comment threads from Figma API
 * - Posting replies to Figma comments
 * - Adding reaction status indicators
 * - Configuration validation and testing
 *
 * @see https://developers.figma.com/docs/rest-api/comments-endpoints/
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
import {
  parseFigmaEmail,
  extractFileKeyFromUrl,
  findCommentByText,
} from '../utils/emailParser'
import { logger } from '../utils/logger'

/**
 * Figma API base URL
 */
const FIGMA_API_BASE = 'https://api.figma.com/v1'

/**
 * Figma API comment object structure
 */
interface FigmaComment {
  id: string
  file_key: string
  parent_id: string
  user: {
    id: string
    handle: string
    img_url?: string
  }
  created_at: string
  resolved_at: string | null
  message: string
  client_meta?: {
    x?: number
    y?: number
    node_id?: string[]
  }
  order_id: number
}

/**
 * Figma API comments response
 */
interface FigmaCommentsResponse {
  comments: FigmaComment[]
}

/**
 * Figma API error response
 */
interface FigmaErrorResponse {
  status: number
  err?: string
  message?: string
}

/**
 * Figma @mention extracted from comment text
 */
export interface FigmaMention {
  userId: string      // Figma user ID (stable identifier)
  displayName: string // Username as displayed
}

/**
 * Figma Adapter Implementation
 */
export class FigmaAdapter implements DiscussionSourceAdapter {
  readonly sourceType = 'figma'

  /**
   * Parse incoming Mailgun webhook containing a Figma email
   *
   * The email should contain:
   * - Figma comment notification
   * - File URL with file key
   * - Sender information
   * - Recipient (used for team resolution)
   *
   * @throws AdapterError if email cannot be parsed or team cannot be resolved
   */
  async parseIncoming(payload: any): Promise<ParsedDiscussion> {
    try {
      // Parse the Mailgun email payload (with redirect following)
      const parsed = await parseFigmaEmail(payload)

      // Validate required fields
      if (!parsed.fileKey) {
        throw new AdapterError('No Figma file key found in email', {
          sourceType: this.sourceType,
          retryable: false,
        })
      }

      if (!parsed.text || parsed.text.trim() === '') {
        throw new AdapterError('No comment text found in email', {
          sourceType: this.sourceType,
          retryable: false,
        })
      }

      // Resolve team ID from recipient email
      // Format expected: <team-slug>@triage.yourdomain.com
      const teamId = this.extractTeamIdFromRecipient(payload.recipient)

      // Extract email slug for config matching (the part before @)
      const emailSlug = this.extractTeamIdFromRecipient(payload.recipient)

      // Build source thread ID (format: fileKey:commentId)
      // Note: commentId might not be available from email, will be resolved during fetchThread
      const sourceThreadId = parsed.fileKey

      // Build source URL
      const sourceUrl = parsed.fileUrl || `https://www.figma.com/file/${parsed.fileKey}`

      // Extract participants from email
      const participants = this.extractParticipants(parsed)

      return {
        sourceType: this.sourceType,
        sourceThreadId,
        sourceUrl,
        teamId,
        authorHandle: parsed.author || 'unknown',
        title: parsed.subject || 'Figma Comment',
        content: parsed.text,
        participants,
        timestamp: parsed.timestamp || new Date(),
        metadata: {
          fileKey: parsed.fileKey,
          emailType: parsed.emailType,
          fileName: parsed.fileName,
          links: parsed.links,
          emailSlug,  // Add email slug for config matching
          recipientEmail: payload.recipient,  // Store full recipient email
        },
      }
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error
      }
      throw new AdapterError(`Failed to parse Figma email: ${(error as Error).message}`, {
        sourceType: this.sourceType,
        retryable: false,
      })
    }
  }

  /**
   * Fetch complete comment thread from Figma API
   *
   * Uses GET /v1/files/:key/comments endpoint to retrieve all comments
   * on a file, then builds a thread structure with root comment and replies.
   *
   * Supported threadId formats:
   * - "fileKey" - Finds most recent root comment
   * - "fileKey:commentId" - Finds specific comment by ID
   * - "fileKey:fuzzy:searchText" - Uses fuzzy matching to find best match (threshold 0.8)
   *
   * @param threadId - Figma file key or enhanced format
   * @param config - Source configuration with API token
   */
  async fetchThread(
    threadId: string,
    config: AdapterConfig,
  ): Promise<DiscussionThread> {
    try {
      // Parse threadId format
      const parts = threadId.split(':')
      const fileKey = parts[0]

      // Determine lookup strategy
      let targetCommentId: string | undefined
      let fuzzySearchText: string | undefined

      if (parts.length === 1) {
        // Format: "fileKey" - use most recent
        targetCommentId = undefined
      } else if (parts[1] === 'fuzzy' && parts.length >= 3) {
        // Format: "fileKey:fuzzy:searchText"
        fuzzySearchText = parts.slice(2).join(':') // Rejoin in case text contains colons
      } else if (parts.length === 2) {
        // Format: "fileKey:commentId"
        targetCommentId = parts[1]
      }

      // Fetch all comments from the file
      const url = `${FIGMA_API_BASE}/files/${fileKey}/comments`
      const response = await fetch(url, {
        headers: {
          'X-Figma-Token': config.apiToken!,
        },
      })

      if (!response.ok) {
        const error = await this.handleApiError(response)
        throw error
      }

      const data = await response.json() as FigmaCommentsResponse

      // Find the root comment using the appropriate strategy
      let rootComment: FigmaComment | undefined

      if (fuzzySearchText) {
        // Use fuzzy matching to find comment by text content
        logger.debug('[FigmaAdapter] Using fuzzy matching to find comment:', {
          searchText: fuzzySearchText.substring(0, 100),
          totalComments: data.comments.length,
        })

        const matchedComment = findCommentByText(
          fuzzySearchText,
          data.comments,
          0.8 // 80% similarity threshold
        )

        rootComment = matchedComment || undefined

        if (!rootComment) {
          logger.warn('[FigmaAdapter] Fuzzy match failed, falling back to most recent comment')
          rootComment = this.findMostRecentRootComment(data.comments)
        }
      } else if (targetCommentId) {
        // Find specific comment by ID
        rootComment = data.comments.find(c => c.id === targetCommentId)
      } else {
        // Use most recent root comment
        rootComment = this.findMostRecentRootComment(data.comments)
      }

      if (!rootComment) {
        throw new AdapterError('Comment not found in file', {
          sourceType: this.sourceType,
          threadId,
          statusCode: 404,
          retryable: false,
        })
      }

      // Debug: Log raw Figma API message content to understand mention format
      logger.info('[FigmaAdapter] Raw comment from API:', {
        commentId: rootComment.id,
        userId: rootComment.user.id,
        userHandle: rootComment.user.handle,
        rawMessage: rootComment.message,
        messageLength: rootComment.message.length,
        // Log character codes to detect special unicode characters
        charCodes: rootComment.message.substring(0, 100).split('').map(c => c.charCodeAt(0)),
      })

      // Build thread structure
      const rootMessage = this.convertToThreadMessage(rootComment)
      const replies = data.comments
        .filter(c => c.parent_id === rootComment.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(c => this.convertToThreadMessage(c))

      // Extract participants (using Figma user IDs)
      const participantHandles = new Set<string>()
      participantHandles.add(rootComment.user.id) // Use user ID instead of handle
      replies.forEach(r => participantHandles.add(r.authorHandle))

      return {
        id: rootComment.id,
        rootMessage,
        replies,
        participants: Array.from(participantHandles),
        metadata: {
          fileKey,
          fileName: '', // Not available from API
          resolved: rootComment.resolved_at !== null,
          createdAt: rootComment.created_at,
        },
      }
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error
      }
      throw new AdapterError(`Failed to fetch Figma thread: ${(error as Error).message}`, {
        sourceType: this.sourceType,
        threadId,
        retryable: true,
      })
    }
  }

  /**
   * Post a reply to a Figma comment thread
   *
   * Uses POST /v1/files/:file_key/comments endpoint with comment_id
   * to create a threaded reply.
   *
   * @param threadId - Format: "fileKey:commentId"
   * @param message - Reply message (plain text or markdown)
   * @param config - Source configuration with API token
   */
  async postReply(
    threadId: string,
    message: string,
    config: AdapterConfig,
  ): Promise<boolean> {
    try {
      const [fileKey, commentId] = threadId.split(':')

      if (!commentId) {
        logger.warn('No commentId provided, cannot post reply')
        return false
      }

      const url = `${FIGMA_API_BASE}/files/${fileKey}/comments`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Figma-Token': config.apiToken!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          comment_id: commentId, // Makes this a threaded reply
        }),
      })

      if (!response.ok) {
        const error = await this.handleApiError(response)
        logger.error('Failed to post Figma reply:', error.message)
        return false
      }

      return true
    } catch (error) {
      logger.error('Failed to post Figma reply:', error)
      return false
    }
  }

  /**
   * Update status by adding a reaction emoji to the comment
   *
   * Uses POST /v1/files/:file_key/comments/:comment_id/reactions
   * to add emoji reactions as status indicators.
   *
   * Status → Emoji mapping:
   * - pending → 👀 (:eyes:)
   * - processing → ⏳ (:hourglass:)
   * - analyzed → 🤖 (:robot:)
   * - completed → ✅ (:white_check_mark:)
   * - failed → ❌ (:x:)
   * - retrying → 🔄 (:arrows_counterclockwise:)
   */
  async updateStatus(
    threadId: string,
    status: DiscussionStatus,
    config: AdapterConfig,
  ): Promise<boolean> {
    try {
      const [fileKey, commentId] = threadId.split(':')

      if (!commentId) {
        logger.warn('No commentId provided, cannot update status')
        return false
      }

      // Map status to emoji
      const emojiMap: Record<DiscussionStatus, string> = {
        pending: ':eyes:',
        processing: ':hourglass:',
        analyzed: ':robot:',
        completed: ':white_check_mark:',
        failed: ':x:',
        retrying: ':arrows_counterclockwise:',
      }

      const emoji = emojiMap[status]

      const url = `${FIGMA_API_BASE}/files/${fileKey}/comments/${commentId}/reactions`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Figma-Token': config.apiToken!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ emoji }),
      })

      if (!response.ok) {
        const error = await this.handleApiError(response)
        logger.error('Failed to update Figma status:', error.message)
        return false
      }

      return true
    } catch (error) {
      logger.error('Failed to update Figma status:', error)
      return false
    }
  }

  /**
   * Remove a reaction emoji from a Figma comment
   *
   * Uses DELETE /v1/files/:file_key/comments/:comment_id/reactions
   * to remove emoji reactions.
   *
   * @param threadId - Format: "fileKey:commentId"
   * @param emoji - Emoji to remove (e.g., "eyes", without colons)
   * @param config - Source configuration with API token
   */
  async removeReaction(
    threadId: string,
    emoji: string,
    config: AdapterConfig,
  ): Promise<boolean> {
    try {
      const [fileKey, commentId] = threadId.split(':')

      if (!commentId) {
        logger.warn('No commentId provided, cannot remove reaction')
        return false
      }

      // Map common emoji names to Figma format (with colons)
      const emojiMap: Record<string, string> = {
        'eyes': ':eyes:',
        'hourglass': ':hourglass:',
        'robot': ':robot:',
        'white_check_mark': ':white_check_mark:',
        'x': ':x:',
        'arrows_counterclockwise': ':arrows_counterclockwise:',
      }

      const figmaEmoji = emojiMap[emoji] || (emoji.startsWith(':') ? emoji : `:${emoji}:`)

      const url = `${FIGMA_API_BASE}/files/${fileKey}/comments/${commentId}/reactions?emoji=${encodeURIComponent(figmaEmoji)}`
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'X-Figma-Token': config.apiToken!,
        },
      })

      if (!response.ok) {
        // Don't treat 404 as an error (reaction might not exist)
        if (response.status === 404) {
          logger.debug('Reaction not found (already removed or never added)')
          return true
        }
        const error = await this.handleApiError(response)
        logger.error('Failed to remove Figma reaction:', error.message)
        return false
      }

      return true
    } catch (error) {
      logger.error('Failed to remove Figma reaction:', error)
      return false
    }
  }

  /**
   * Validate Figma source configuration
   *
   * Checks:
   * - API token is present and properly formatted
   * - Notion token is present
   * - Notion database ID is present
   * - Settings are valid
   */
  async validateConfig(config: AdapterConfig): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check API token
    if (!config.apiToken || config.apiToken.trim() === '') {
      errors.push('Figma API token is required')
    } else if (config.apiToken.length < 20) {
      warnings.push('Figma API token appears to be too short')
    }

    // Check Notion configuration
    const notionToken = (config as any).notionToken
    if (!notionToken || notionToken.trim() === '') {
      errors.push('Notion API token is required')
    }

    const notionDatabaseId = (config as any).notionDatabaseId
    if (!notionDatabaseId || notionDatabaseId.trim() === '') {
      errors.push('Notion database ID is required')
    }

    // Check source type matches
    if (config.sourceType !== this.sourceType) {
      errors.push(`Source type mismatch: expected '${this.sourceType}', got '${config.sourceType}'`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Test connection to Figma API
   *
   * Makes a simple API call to verify the token is valid and API is reachable.
   * Uses the /v1/me endpoint to check authentication.
   */
  async testConnection(config: AdapterConfig): Promise<boolean> {
    try {
      const url = `${FIGMA_API_BASE}/me`
      const response = await fetch(url, {
        headers: {
          'X-Figma-Token': config.apiToken!,
        },
      })

      return response.ok
    } catch (error) {
      logger.error('Failed to test Figma connection:', error)
      return false
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Extract team ID from recipient email address
   *
   * Expected format: <team-slug>@triage.yourdomain.com
   * Falls back to 'default' if parsing fails
   */
  private extractTeamIdFromRecipient(recipient: string): string {
    if (!recipient) {
      return 'default'
    }

    // Extract the local part before @
    const match = recipient.match(/^([^@]+)@/)
    if (!match || !match[1]) {
      return 'default'
    }

    return match[1]
  }

  /**
   * Extract participant handles from parsed email
   */
  private extractParticipants(parsed: any): string[] {
    const participants = new Set<string>()

    // Add author
    if (parsed.author) {
      participants.add(parsed.author)
    }

    // Could parse mentions from content in the future
    // For now, just return the author

    return Array.from(participants)
  }

  /**
   * Find the most recent root comment (comment without parent)
   * Used when no specific comment ID is provided
   */
  private findMostRecentRootComment(comments: FigmaComment[]): FigmaComment | undefined {
    const rootComments = comments.filter(c => !c.parent_id)
    if (rootComments.length === 0) {
      return undefined
    }

    return rootComments.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
  }

  /**
   * Convert Figma comment to ThreadMessage format
   *
   * Uses Figma user ID as authorHandle for reliable user mapping.
   * The user's display name (handle) is stored as authorName for AI prompts and UI.
   */
  private convertToThreadMessage(comment: FigmaComment): ThreadMessage {
    return {
      id: comment.id,
      // Use Figma user ID as authorHandle for user mapping lookup
      // This is more reliable than handle (username) which can change
      authorHandle: comment.user.id,
      // Store display name for AI analysis and Notion display
      authorName: comment.user.handle,
      content: comment.message,
      timestamp: new Date(comment.created_at),
    }
  }

  /**
   * Handle Figma API errors and convert to AdapterError
   */
  private async handleApiError(response: Response): Promise<AdapterError> {
    let errorMessage = `Figma API error: ${response.status} ${response.statusText}`
    let retryable = false

    try {
      const errorData = await response.json() as FigmaErrorResponse
      if (errorData.err || errorData.message) {
        errorMessage = errorData.err || errorData.message || errorMessage
      }
    } catch {
      // Unable to parse error response, use default message
    }

    // Determine if error is retryable
    if (response.status >= 500 || response.status === 429) {
      retryable = true
    }

    return new AdapterError(errorMessage, {
      sourceType: this.sourceType,
      statusCode: response.status,
      retryable,
    })
  }
}

/**
 * Extract @mentions from Figma comment text
 *
 * Figma formats mentions in several ways:
 * 1. Parentheses format: @Name (uuid) - most common in real Figma comments
 * 2. Bracket format: @[userId:displayName] - alternative format
 * 3. Plain text: @username - fallback when mention isn't resolved
 *
 * @param message - The comment text to parse
 * @returns Array of extracted mentions with userId and displayName
 */
export function extractMentionsFromComment(message: string): FigmaMention[] {
  if (!message || message.trim() === '') {
    return []
  }

  const mentions: FigmaMention[] = []

  // First try: Figma parentheses format @Name (uuid)
  // This is the most common format in real Figma comments
  // Example: "@Maarten Lauwaert (a36f9347-1da7-400e-9ac5-06442413f18d)"
  const parenMentionRegex = /@([^(@]+?)\s*\(([a-f0-9-]+)\)/gi

  let parenMatch: RegExpExecArray | null
  while ((parenMatch = parenMentionRegex.exec(message)) !== null) {
    const displayName = parenMatch[1]
    const userId = parenMatch[2]

    // Only add if both userId and displayName are non-empty
    if (userId && displayName) {
      mentions.push({
        userId: userId.trim(),
        displayName: displayName.trim(),
      })
    }
  }

  // Second try: Figma bracket format @[userId:displayName]
  // Alternative format that may be used by some Figma integrations
  if (mentions.length === 0) {
    const bracketRegex = /@\[([^\]:]+):([^\]]+)\]/g

    let match: RegExpExecArray | null
    while ((match = bracketRegex.exec(message)) !== null) {
      const userId = match[1]
      const displayName = match[2]

      // Only add if both userId and displayName are non-empty
      if (userId && displayName) {
        mentions.push({
          userId: userId.trim(),
          displayName: displayName.trim(),
        })
      }
    }
  }

  // Fallback: if no structured mentions found, try plain text @mentions
  // This handles cases where Figma doesn't resolve the mentions
  // NOTE: This uses username as userId which may not be accurate
  if (mentions.length === 0) {
    const plainMentionRegex = /@([a-zA-Z0-9_.-]+)/g
    let plainMatch: RegExpExecArray | null
    while ((plainMatch = plainMentionRegex.exec(message)) !== null) {
      const username = plainMatch[1]
      if (!username) continue
      // Skip common non-user patterns
      if (!['everyone', 'here', 'channel'].includes(username.toLowerCase())) {
        mentions.push({
          userId: username,
          displayName: username,
        })
      }
    }
  }

  return mentions
}

/**
 * Create a new Figma adapter instance
 */
export function createFigmaAdapter(): DiscussionSourceAdapter {
  return new FigmaAdapter()
}
