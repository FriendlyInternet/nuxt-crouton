/**
 * Base Adapter Interface for Discussion Sources
 *
 * This file defines the standardized interface that all discussion source
 * adapters must implement. The adapter pattern allows Triage to support
 * multiple discussion platforms (Figma, Slack, Linear, etc.) while maintaining
 * a consistent processing pipeline.
 *
 * @see docs/briefings/triage-architecture-brief.md (Section: Source Adapter Pattern)
 */

import type {
  ParsedDiscussion,
  DiscussionThread,
  DiscussionStatus,
  AdapterConfig,
  ValidationResult,
} from '../../app/types'
import { logger } from '../utils/logger'

/**
 * Discussion Source Adapter Interface
 *
 * All discussion sources (Figma, Slack, Linear, etc.) implement this interface
 * to provide a standardized way to:
 * 1. Parse incoming webhooks/emails into a common format
 * 2. Fetch full thread details from the source
 * 3. Post replies back to the source
 * 4. Update status indicators (reactions, emoji, status fields)
 * 5. Validate and test source configurations
 *
 * Benefits of this pattern:
 * - **Isolation**: Each source is self-contained, changes don't affect others
 * - **Testability**: Can mock adapters easily for testing
 * - **Extensibility**: New sources = new adapter class, no core changes
 * - **Consistency**: All sources produce same output format
 * - **Flexibility**: Adapters can have source-specific optimizations
 *
 * @example
 * ```typescript
 * // Implementing a new adapter
 * export class LinearAdapter implements DiscussionSourceAdapter {
 *   sourceType = 'linear'
 *
 *   async parseIncoming(payload: any): Promise<ParsedDiscussion> {
 *     // Parse Linear webhook payload
 *     return {
 *       sourceType: 'linear',
 *       sourceThreadId: payload.data.id,
 *       sourceUrl: payload.data.url,
 *       teamId: resolvedTeamId,
 *       // ... other fields
 *     }
 *   }
 *
 *   // ... implement other methods
 * }
 * ```
 */
export interface DiscussionSourceAdapter {
  /**
   * Unique identifier for this source type
   * Should be lowercase, alphanumeric (e.g., 'figma', 'slack', 'linear')
   */
  readonly sourceType: string

  /**
   * Parse incoming webhook/email into standardized format
   *
   * This method is called by webhook handlers to convert source-specific
   * payloads into a common ParsedDiscussion format that can be processed
   * by the unified pipeline.
   *
   * Responsibilities:
   * - Extract discussion metadata (title, author, participants)
   * - Resolve team ID (from email address, workspace ID, etc.)
   * - Build deep link URL back to source
   * - Handle source-specific payload quirks
   * - Validate required fields are present
   *
   * @param payload - Raw webhook/email payload (source-specific format)
   * @returns Standardized ParsedDiscussion object
   * @throws Error if payload is invalid or team cannot be resolved
   *
   * @example
   * ```typescript
   * // Figma adapter (email-based)
   * const parsed = await adapter.parseIncoming(mailgunPayload)
   * // Returns: { sourceType: 'figma', teamId: 'team_123', ... }
   *
   * // Slack adapter (webhook-based)
   * const parsed = await adapter.parseIncoming(slackEventPayload)
   * // Returns: { sourceType: 'slack', teamId: 'team_456', ... }
   * ```
   */
  parseIncoming(payload: any): Promise<ParsedDiscussion>

  /**
   * Fetch full thread details from source
   *
   * This method is called during the Thread Building stage (Stage 3) to
   * retrieve the complete conversation thread including all replies.
   *
   * Responsibilities:
   * - Call source API to fetch thread data
   * - Build thread structure (root message + replies)
   * - Extract participant list
   * - Handle pagination if thread is large
   * - Map source-specific fields to standard format
   *
   * @param threadId - Source-specific thread identifier
   * @param config - Source configuration (API keys, settings)
   * @returns Complete DiscussionThread with all messages
   * @throws Error if thread not found or API call fails
   *
   * @example
   * ```typescript
   * // Figma: threadId = "file_key:comment_id"
   * const thread = await adapter.fetchThread(
   *   'abc123:comment_456',
   *   config
   * )
   *
   * // Slack: threadId = "channel_id:thread_ts"
   * const thread = await adapter.fetchThread(
   *   'C123456:1234567890.123456',
   *   config
   * )
   * ```
   */
  fetchThread(
    threadId: string,
    config: AdapterConfig,
  ): Promise<DiscussionThread>

  /**
   * Post a reply message back to the source
   *
   * This method is called during the Notification stage (Stage 6) to
   * send a confirmation message back to the original discussion thread.
   *
   * Responsibilities:
   * - Format message for source platform
   * - Call source API to post reply
   * - Handle rate limiting
   * - Return success/failure status
   *
   * @param threadId - Source-specific thread identifier
   * @param message - Reply message content (markdown/plain text)
   * @param config - Source configuration (API keys, settings)
   * @returns true if reply posted successfully, false otherwise
   *
   * @example
   * ```typescript
   * // Single task confirmation
   * const success = await adapter.postReply(
   *   threadId,
   *   '✅ Task created: Fix login button\n🔗 https://notion.so/page123',
   *   config
   * )
   *
   * // Multi-task confirmation
   * const success = await adapter.postReply(
   *   threadId,
   *   '✅ Created 3 tasks:\n1. Fix button\n2. Update docs\n3. Add tests',
   *   config
   * )
   * ```
   */
  postReply(
    threadId: string,
    message: string,
    config: AdapterConfig,
  ): Promise<boolean>

  /**
   * Update status indicators in source
   *
   * This method is called to add visual indicators (reactions, emoji, status
   * fields) to show processing state in the source platform.
   *
   * Status mapping examples:
   * - 'pending' → 👀 (eyes)
   * - 'processing' → ⏳ (hourglass)
   * - 'completed' → ✅ (white_check_mark)
   * - 'failed' → ❌ (x)
   *
   * @param threadId - Source-specific thread identifier
   * @param status - Current discussion status
   * @param config - Source configuration (API keys, settings)
   * @returns true if status updated successfully, false otherwise
   *
   * @example
   * ```typescript
   * // Figma: Add reaction to comment
   * await adapter.updateStatus(threadId, 'completed', config)
   * // Adds ✅ reaction to Figma comment
   *
   * // Slack: Add emoji reaction to message
   * await adapter.updateStatus(threadId, 'processing', config)
   * // Adds ⏳ emoji to Slack message
   *
   * // Linear: Update issue status field
   * await adapter.updateStatus(threadId, 'completed', config)
   * // Updates Linear issue status to "Done"
   * ```
   */
  updateStatus(
    threadId: string,
    status: DiscussionStatus,
    config: AdapterConfig,
  ): Promise<boolean>

  /**
   * Validate source configuration
   *
   * This method verifies that all required fields are present and properly
   * formatted before attempting to use the configuration.
   *
   * Validation checks:
   * - API token format and presence
   * - Required settings are present
   * - URLs are valid (if applicable)
   * - IDs match expected format
   *
   * @param config - Source configuration to validate
   * @returns ValidationResult with errors and warnings
   *
   * @example
   * ```typescript
   * const result = await adapter.validateConfig(config)
   * if (!result.valid) {
   *   logger.error('Config errors:', result.errors)
   *   // ['apiToken is required', 'Invalid workspace ID format']
   * }
   * if (result.warnings.length > 0) {
   *   logger.warn('Config warnings:', result.warnings)
   *   // ['API token appears to be expired']
   * }
   * ```
   */
  validateConfig(config: AdapterConfig): Promise<ValidationResult>

  /**
   * Test connection to source API
   *
   * This method performs a simple API call to verify that the configuration
   * is working and the API is reachable. Used for health checks and config
   * validation in the admin UI.
   *
   * @param config - Source configuration to test
   * @returns true if connection successful, false otherwise
   *
   * @example
   * ```typescript
   * // Test Figma API access
   * const canConnect = await adapter.testConnection(config)
   * if (!canConnect) {
   *   throw new Error('Cannot connect to Figma API - check token')
   * }
   *
   * // Used in admin UI
   * <UButton @click="testConnection">
   *   Test Connection
   * </UButton>
   * ```
   */
  testConnection(config: AdapterConfig): Promise<boolean>
}

/**
 * Helper type for adapter registry/factory pattern
 *
 * @example
 * ```typescript
 * const ADAPTERS: Record<string, DiscussionSourceAdapter> = {
 *   figma: new FigmaAdapter(),
 *   slack: new SlackAdapter(),
 *   linear: new LinearAdapter(),
 * }
 *
 * function getAdapter(sourceType: string): DiscussionSourceAdapter {
 *   const adapter = ADAPTERS[sourceType]
 *   if (!adapter) {
 *     throw new Error(`Unknown source type: ${sourceType}`)
 *   }
 *   return adapter
 * }
 * ```
 */
export type AdapterRegistry = Record<string, DiscussionSourceAdapter>

/**
 * Base error class for adapter-specific errors
 *
 * @example
 * ```typescript
 * throw new AdapterError('Failed to fetch thread', {
 *   sourceType: 'figma',
 *   threadId: 'abc123',
 *   statusCode: 404
 * })
 * ```
 */
export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly context?: {
      sourceType?: string
      threadId?: string
      statusCode?: number
      retryable?: boolean
    },
  ) {
    super(message)
    this.name = 'AdapterError'
  }
}
