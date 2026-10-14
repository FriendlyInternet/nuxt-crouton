/// <reference path="../crouton-hooks.d.ts" />

import { useNitroApp } from 'nitropack/runtime'

/**
 * Processor Service - Discussion Processing Orchestration
 *
 * This is the heart of Crouton Triage. It orchestrates the complete workflow:
 *
 * **Processing Pipeline (6 Stages):**
 *
 * 1. **Validation** - Validate incoming discussion, check required fields
 * 2. **Config Loading** - Load source configuration (API keys, settings)
 * 3. **Thread Building** - Build complete thread (via adapter or direct input)
 * 4. **AI Analysis** - Analyze with Claude (summary + task detection)
 * 5. **Task Creation** - Create tasks in Notion
 * 6. **Notification** - Update status and send confirmations
 *
 * **Error Handling:**
 * - Transient failures → Retry with exponential backoff
 * - Permanent failures → Mark as failed, log error
 * - Status tracking at each stage for observability
 *
 * **Design Principles:**
 * - Fail fast with clear error messages
 * - Update status at each stage for UI tracking
 * - Log key events for debugging
 * - Support both adapter-based and direct thread input
 * - Keep it simple (KISS) - optimize later if needed
 */

import type {
  ParsedDiscussion,
  DiscussionThread,
  DiscussionStatus,
  AIAnalysisResult,
  NotionTaskResult,
  NotionTaskConfig,
  AdapterConfig,
  Flow,
  FlowInput,
  FlowOutput,
} from '../../app/types'
import { analyzeDiscussion } from './ai'
import { extractMentionsFromComment } from '../adapters/figma'
import { createNotionTask, createNotionTasks, createNotionConfigFromOutput, type SourceMetadata } from './notion'
import { generateReplyMessage, generateBootstrapMessage } from './reply-generator'
import { retryWithBackoff } from '../utils/retry'
import { SYSTEM_USER_ID } from '../utils/constants'
import { logger } from '../utils/logger'
import { eq, and } from 'drizzle-orm'
import { routeTaskToOutputs } from '../utils/domain-routing'

/**
 * Module-level teamId storage for database updates
 * Set during saveDiscussion(), used by update functions
 */
let currentTeamId: string | undefined

/**
 * Processing result returned after successful processing
 */
export interface ProcessingResult {
  /** Discussion ID in database */
  discussionId: string
  /** AI analysis results */
  aiAnalysis: AIAnalysisResult
  /** Created Notion task IDs and URLs */
  notionTasks: NotionTaskResult[]
  /** Total processing time in milliseconds */
  processingTime: number
  /** Whether this was a multi-task discussion */
  isMultiTask: boolean
  /** Correlation ID linking all pipeline stages for this request */
  correlationId?: string
}

/**
 * Processing error with context
 */
export class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly context?: Record<string, any>,
    public readonly retryable: boolean = false,
  ) {
    super(message)
    this.name = 'ProcessingError'
  }
}

/**
 * Complete flow with inputs and outputs
 */
export interface FlowWithRelations {
  flow: Flow
  inputs: FlowInput[]
  outputs: FlowOutput[]
  /** The specific input that matched this request */
  matchedInput: FlowInput
}

/**
 * Validate parsed discussion has all required fields
 */
function validateParsedDiscussion(parsed: ParsedDiscussion): void {
  const required = [
    'sourceType',
    'sourceThreadId',
    'sourceUrl',
    'teamId',
    'authorHandle',
    'title',
    'content',
  ]

  const missing = required.filter(field => !parsed[field as keyof ParsedDiscussion])

  if (missing.length > 0) {
    throw new ProcessingError(
      `Missing required fields: ${missing.join(', ')}`,
      'validation',
      { missing },
      false, // Not retryable - bad input
    )
  }
}

/**
 * Bootstrap comment detection result
 */
export interface BootstrapCommentResult {
  isBootstrap: boolean
  mentionedUsers: Array<{ userId: string, displayName: string }>
  reason?: string
}

/**
 * Store discovered users as pending user mappings
 *
 * Creates user mappings with notionUserId: null (pending state) for discovered
 * users from bootstrap comments. Skips users that already have mappings.
 *
 * @param mentionedUsers - Users discovered from @mentions
 * @param teamId - Team ID for the mapping
 * @param sourceType - Source platform ('slack' | 'figma')
 * @param sourceWorkspaceId - Workspace identifier (Slack team ID or Figma email slug)
 * @returns Number of new pending mappings created
 */
async function storeDiscoveredUsers(
  mentionedUsers: Array<{ userId: string, displayName: string }>,
  teamId: string,
  sourceType: string,
  sourceWorkspaceId: string,
): Promise<number> {
  if (mentionedUsers.length === 0) {
    return 0
  }

  const { createTriageUser: createTriageUserMapping } = await import(
    '~~/layers/triage/collections/users/server/database/queries'
  )

  // Get existing mappings to avoid duplicates
  const { getAllTriageUsers } = await import(
    '~~/layers/triage/collections/users/server/database/queries'
  )
  const existingMappings = await getAllTriageUsers(teamId)

  // Debug: log what we got
  logger.debug('Existing mappings for duplicate check', {
    count: existingMappings.length,
    mappings: existingMappings.map((m: any) => ({
      sourceType: m.sourceType,
      sourceWorkspaceId: m.sourceWorkspaceId,
      sourceUserId: m.sourceUserId,
    })),
  })

  const existingSourceUserIds = new Set(
    existingMappings
      .filter((m: any) => m.sourceType === sourceType && m.sourceWorkspaceId === sourceWorkspaceId)
      .map((m: any) => m.sourceUserId),
  )

  logger.debug('Existing source user IDs for this workspace', {
    sourceType,
    sourceWorkspaceId,
    existingIds: Array.from(existingSourceUserIds),
  })

  let createdCount = 0

  for (const user of mentionedUsers) {
    // Skip if mapping already exists for this source user
    if (existingSourceUserIds.has(user.userId)) {
      logger.debug('Skipping discovered user - mapping already exists', {
        userId: user.userId,
        displayName: user.displayName,
      })
      continue
    }

    try {
      await createTriageUserMapping({
        teamId,
        owner: SYSTEM_USER_ID,
        sourceType,
        sourceWorkspaceId,
        sourceUserId: user.userId,
        sourceUserName: user.displayName,
        sourceUserEmail: undefined, // Unknown from @mention
        notionUserId: null as any, // Pending - to be mapped by user
        notionUserName: undefined,
        notionUserEmail: undefined,
        mappingType: 'discovered',
        confidence: 0, // No confidence until mapped
        active: false, // Inactive until mapped
        metadata: {
          discoveredAt: new Date().toISOString(),
          discoverySource: 'bootstrap_comment',
        },
      })
      createdCount++
      logger.debug('Created pending user mapping', {
        userId: user.userId,
        displayName: user.displayName,
        sourceType,
        sourceWorkspaceId,
      })
    } catch (error) {
      logger.warn('Failed to create pending user mapping', {
        userId: user.userId,
        error,
      })
    }
  }

  logger.info('Stored discovered users as pending mappings', {
    totalDiscovered: mentionedUsers.length,
    newMappingsCreated: createdCount,
    skippedExisting: mentionedUsers.length - createdCount,
    sourceType,
    sourceWorkspaceId,
  })

  return createdCount
}

/**
 * Detect if a thread is a bootstrap/user sync comment
 *
 * Bootstrap comments are used to trigger user discovery without creating tasks.
 * Detection triggers (case insensitive, checked in both API and email content):
 * - Text contains "user sync"
 * - Text contains "bootstrap"
 *
 * Expected format: @bot User Sync: @user1 @user2 @user3
 * - Bot mention first (triggers webhook)
 * - "User Sync:" keyword
 * - Users to discover listed AFTER the keyword
 *
 * For Figma sources, only extracts @mentions AFTER "user sync:" to exclude the bot.
 *
 * @param thread - The discussion thread to check
 * @param sourceType - The source type ('slack' | 'figma')
 * @param emailContent - Optional email body content (for additional trigger detection)
 * @returns Bootstrap detection result with extracted mentions
 */
export function isBootstrapComment(
  thread: DiscussionThread,
  sourceType: string,
  emailContent?: string,
): BootstrapCommentResult {
  const apiContent = thread.rootMessage.content.toLowerCase()
  const emailBody = emailContent?.toLowerCase() || ''

  // Check for bootstrap triggers in BOTH API content and email body
  // The bot can have any name (e.g., "legoman"), so we just look for keywords
  const hasUserSync = apiContent.includes('user sync') || emailBody.includes('user sync')
  const hasBootstrap = apiContent.includes('bootstrap') || emailBody.includes('bootstrap')

  const isBootstrap = hasUserSync || hasBootstrap

  if (!isBootstrap) {
    return {
      isBootstrap: false,
      mentionedUsers: [],
    }
  }

  // Determine the reason for bootstrap detection
  let reason: string
  if (hasUserSync) {
    reason = 'Contains "user sync" keyword'
  } else {
    reason = 'Contains "bootstrap" keyword'
  }

  // Extract mentions based on source type
  // For Figma, only extract mentions AFTER "user sync:" to exclude the bot mention
  let mentionedUsers: Array<{ userId: string, displayName: string }> = []

  if (sourceType === 'figma') {
    // IMPORTANT: Figma API does NOT include user IDs in @mention text
    // The only way to get a user's Figma ID is from comment.user.id (the comment author)
    //
    // Strategy: Capture all unique users who have posted in this thread
    // Each participant's authorHandle = their Figma user ID
    // Each participant's authorName = their display name

    logger.info('Figma bootstrap: Capturing thread participants as discovered users', {
      rootAuthorHandle: thread.rootMessage.authorHandle,
      rootAuthorName: thread.rootMessage.authorName,
      replyCount: thread.replies.length,
    })

    // Collect unique users from thread (author + any reply authors)
    const userMap = new Map<string, string>() // userId -> displayName

    // Add root message author
    if (thread.rootMessage.authorHandle && thread.rootMessage.authorName) {
      userMap.set(thread.rootMessage.authorHandle, thread.rootMessage.authorName)
    }

    // Add reply authors (if any)
    for (const reply of thread.replies) {
      if (reply.authorHandle && reply.authorName) {
        // Skip if this looks like a bot (numeric ID with no meaningful name, or same as bot)
        // The bot's handle is usually in the participants list but we want real users
        userMap.set(reply.authorHandle, reply.authorName)
      }
    }

    // Convert to array format
    mentionedUsers = Array.from(userMap.entries()).map(([userId, displayName]) => ({
      userId,
      displayName,
    }))

    logger.info('Figma bootstrap: Discovered users from thread participants', {
      userCount: mentionedUsers.length,
      users: mentionedUsers,
    })
  }
  // For Slack, mentions would be extracted differently (already parsed by Slack adapter)
  // Could add Slack mention extraction here if needed

  return {
    isBootstrap: true,
    mentionedUsers,
    reason,
  }
}

/**
 * Match an active input row against the source identifier for its source type
 */
function inputMatchesIdentifier(
  input: any,
  sourceType: string,
  identifier: string,
  metadata?: Record<string, any>,
): boolean {
  if (sourceType === 'slack') {
    return input.sourceMetadata?.slackTeamId === identifier
  } else if (sourceType === 'figma') {
    return input.emailSlug === metadata?.emailSlug
  } else if (sourceType === 'notion') {
    // Match by workspace ID stored in sourceMetadata
    // Check metadata.notionWorkspaceId first (preferred), then fall back to identifier
    const inputWorkspaceId = input.sourceMetadata?.notionWorkspaceId
    const lookupWorkspaceId = metadata?.notionWorkspaceId || identifier
    if (inputWorkspaceId) {
      return inputWorkspaceId === lookupWorkspaceId
    }
    // Fallback: if no workspace ID stored, accept any active Notion input
    return true
  }
  return false
}

/**
 * Load flow with inputs and outputs by input identifier
 *
 * Queries flowinputs by slackTeamId (from sourceMetadata) or emailSlug,
 * then loads the associated flow and all its outputs.
 *
 * @param identifier - Slack team ID or email slug used to find the input
 * @param sourceType - Source type ('slack' or 'figma')
 * @param metadata - Additional metadata (e.g., emailSlug for Figma)
 * @returns Complete flow with inputs, outputs, and matched input
 */
async function loadFlow(
  identifier: string,
  sourceType: string,
  metadata?: Record<string, any>,
): Promise<FlowWithRelations> {
  const db = useDB()

  // Import schemas
  const { triageInputs } = await import(
    '~~/layers/triage/collections/inputs/server/database/schema'
  )
  const { triageFlows } = await import(
    '~~/layers/triage/collections/flows/server/database/schema'
  )
  const { triageOutputs } = await import(
    '~~/layers/triage/collections/outputs/server/database/schema'
  )

  // Query all active inputs of this source type
  const inputs = await db
    .select()
    .from(triageInputs)
    .where(and(
      eq(triageInputs.sourceType, sourceType),
      eq(triageInputs.active, true),
    ))
    .all()

  // Find matching input AND verify flow exists (defensive against orphans)
  let matchedInput: any
  let flow: any

  // Filter inputs by source identifier
  const candidateInputs = inputs.filter((input: any) => inputMatchesIdentifier(input, sourceType, identifier, metadata))

  // Try each candidate input and verify its flow exists
  for (const input of candidateInputs) {
    const [existingFlow] = await db
      .select()
      .from(triageFlows)
      .where(and(
        eq(triageFlows.id, input.flowId),
        eq(triageFlows.active, true),
      ))
      .limit(1)

    if (existingFlow) {
      // Found valid input with existing flow
      matchedInput = input
      flow = existingFlow
      break
    }

    // Orphaned input detected - log warning and continue searching
    logger.warn('Skipping orphaned input (flow no longer exists)', {
      inputId: input.id,
      flowId: input.flowId,
      sourceType,
      identifier,
    })
  }

  if (!matchedInput || !flow) {
    throw new ProcessingError(
      `No active flow input found for ${sourceType} identifier: ${identifier}`,
      'flow_loading',
      { identifier, sourceType, emailSlug: metadata?.emailSlug, availableInputs: inputs.length, candidateInputs: candidateInputs.length },
      false,
    )
  }

  // Load all inputs for this flow
  const allInputs = await db
    .select()
    .from(triageInputs)
    .where(and(
      eq(triageInputs.flowId, flow.id),
      eq(triageInputs.active, true),
    ))
    .all()

  // Load all outputs for this flow
  const outputs = await db
    .select()
    .from(triageOutputs)
    .where(and(
      eq(triageOutputs.flowId, flow.id),
      eq(triageOutputs.active, true),
    ))
    .all()

  logger.info('Flow loaded', {
    flowId: flow.id,
    flowName: flow.name,
    inputCount: allInputs.length,
    outputCount: outputs.length,
    matchedInputId: matchedInput.id,
  })

  return {
    flow: flow as Flow,
    inputs: allInputs as FlowInput[],
    outputs: outputs as FlowOutput[],
    matchedInput: matchedInput as FlowInput,
  }
}

// Legacy loadSourceConfig removed — v2 uses loadFlow() exclusively

/**
 * Save discussion to database
 *
 * Creates a new discussion record with initial status using Crouton queries.
 * Note: authorHandle and participants may be placeholder values at this point
 * (e.g., from Figma webhook email addresses). They will be updated after
 * thread building with correct values via updateDiscussionMetadata().
 */
async function saveDiscussion(
  parsed: ParsedDiscussion,
  flowInputId: string,
  actualTeamId: string,
  status: DiscussionStatus = 'pending',
): Promise<string> {
  logger.debug('Saving discussion to database', {
    sourceType: parsed.sourceType,
    sourceThreadId: parsed.sourceThreadId,
    status,
    actualTeamId,
  })

  // Store teamId for use in update functions
  currentTeamId = actualTeamId

  // Import Crouton query
  const { createTriageDiscussion } = await import(
    '~~/layers/triage/collections/discussions/server/database/queries'
  )

  // Create discussion record
  // NOTE: For Figma, authorHandle and participants contain email addresses at this point
  // They will be updated after thread building with actual user names
  const discussion = await createTriageDiscussion({
    teamId: actualTeamId, // Use actual team ID from config, not source identifier
    owner: SYSTEM_USER_ID,
    createdBy: SYSTEM_USER_ID,
    updatedBy: SYSTEM_USER_ID,
    sourceType: parsed.sourceType,
    sourceThreadId: parsed.sourceThreadId,
    sourceUrl: parsed.sourceUrl,
    flowInputId,
    title: parsed.title,
    content: parsed.content,
    authorHandle: parsed.authorHandle, // Placeholder - will be updated after thread building
    participants: parsed.participants, // Placeholder - will be updated after thread building
    status,
    rawPayload: parsed.metadata,
    metadata: {},
    threadData: {},
  })

  if (!discussion) {
    throw new ProcessingError(
      'Failed to create discussion record',
      'save_discussion',
      { sourceType: parsed.sourceType, sourceThreadId: parsed.sourceThreadId },
      false,
    )
  }

  logger.info('Discussion saved', { discussionId: discussion.id })

  return discussion.id
}

/**
 * Update discussion status in database using Crouton queries
 */
async function updateDiscussionStatus(
  discussionId: string,
  status: DiscussionStatus,
  error?: string,
): Promise<void> {
  logger.debug('Updating discussion status', {
    discussionId,
    status,
    error,
  })

  // Verify teamId is available
  if (!currentTeamId) {
    throw new ProcessingError(
      'TeamId not available for discussion update',
      'update_status',
      { discussionId },
      false,
    )
  }

  // Import Crouton query
  const { updateTriageDiscussion } = await import(
    '~~/layers/triage/collections/discussions/server/database/queries'
  )

  // Update discussion with new status
  await updateTriageDiscussion(
    discussionId,
    currentTeamId,
    SYSTEM_USER_ID,
    {
      status,
      ...(error && { metadata: { error } }),
    },
  )

  logger.debug('Discussion status updated', { discussionId, status })
}

/**
 * Update discussion metadata after thread building
 *
 * Updates authorHandle and participants with correct values from the built thread.
 * This fixes the issue where Figma discussions initially have email addresses instead
 * of actual user names.
 */
async function updateDiscussionMetadata(
  discussionId: string,
  thread: DiscussionThread,
): Promise<void> {
  logger.debug('Updating discussion metadata', {
    discussionId,
    authorHandle: thread.rootMessage.authorHandle,
    participantCount: thread.participants.length,
  })

  // Verify teamId is available
  if (!currentTeamId) {
    throw new ProcessingError(
      'TeamId not available for discussion update',
      'update_metadata',
      { discussionId },
      false,
    )
  }

  // Import Crouton query
  const { updateTriageDiscussion } = await import(
    '~~/layers/triage/collections/discussions/server/database/queries'
  )

  // Update discussion with correct authorHandle and participants from thread
  await updateTriageDiscussion(
    discussionId,
    currentTeamId,
    SYSTEM_USER_ID,
    {
      authorHandle: thread.rootMessage.authorHandle,
      participants: thread.participants,
    },
  )

  logger.debug('Discussion metadata updated')
}

/**
 * Update discussion with processing results using Crouton queries
 */
async function updateDiscussionResults(
  discussionId: string,
  thread: DiscussionThread,
  aiAnalysis: AIAnalysisResult,
  notionTasks: NotionTaskResult[],
): Promise<void> {
  logger.debug('Updating discussion with results', {
    discussionId,
    taskCount: notionTasks.length,
  })

  // Verify teamId is available
  if (!currentTeamId) {
    throw new ProcessingError(
      'TeamId not available for discussion update',
      'update_results',
      { discussionId },
      false,
    )
  }

  // Import Crouton query
  const { updateTriageDiscussion } = await import(
    '~~/layers/triage/collections/discussions/server/database/queries'
  )

  // Update discussion with all processing results
  await updateTriageDiscussion(
    discussionId,
    currentTeamId,
    SYSTEM_USER_ID,
    {
      status: 'completed',
      threadData: thread,
      totalMessages: thread.replies.length + 1,
      aiSummary: aiAnalysis.summary.summary,
      aiKeyPoints: aiAnalysis.summary.keyPoints,
      aiTasks: aiAnalysis.taskDetection,
      isMultiTask: aiAnalysis.taskDetection.isMultiTask,
      // notionTaskIds will be set by saveTaskRecords() after task records are created
      processedAt: new Date(),
    },
  )

  logger.debug('Discussion results saved')
}

/**
 * Save task records to database after Notion task creation
 */
async function saveTaskRecords(
  notionTasks: NotionTaskResult[],
  aiTasks: any[],
  discussionId: string,
  jobId: string,
  parsed: ParsedDiscussion,
): Promise<string[]> {
  logger.debug('Saving task records', {
    count: notionTasks.length,
    discussionId,
    jobId,
  })

  // Verify teamId is available
  if (!currentTeamId) {
    logger.error('TeamId not available for task creation')
    return []
  }

  try {
    // Import Crouton query for task creation
    const { createTriageTask } = await import(
      '~~/layers/triage/collections/tasks/server/database/queries'
    )

    const taskIds: string[] = []

    // Create task records for each Notion task
    for (let i = 0; i < notionTasks.length; i++) {
      const notionTask = notionTasks[i]
      const aiTask = aiTasks[i] || aiTasks[0] // Fallback to first task if index mismatch

      // Skip if notionTask is undefined
      if (!notionTask) {
        logger.warn('Skipping undefined notionTask', { index: i })
        continue
      }

      try {
        const task = await createTriageTask({
          teamId: currentTeamId,
          owner: SYSTEM_USER_ID,
          discussionId,
          syncJobId: jobId,
          notionPageId: notionTask.id,
          notionPageUrl: notionTask.url,
          title: aiTask?.title || parsed.title,
          description: aiTask?.description || undefined,
          status: 'todo',
          priority: aiTask?.priority || undefined,
          assignee: aiTask?.assignee || undefined,
          summary: aiTask?.description || undefined,
          sourceUrl: parsed.sourceUrl,
          isMultiTaskChild: notionTasks.length > 1,
          taskIndex: notionTasks.length > 1 ? i : undefined,
          metadata: {
            createdAt: notionTask.createdAt.toISOString(),
            sourceType: parsed.sourceType,
            sourceThreadId: parsed.sourceThreadId,
          },
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        } as any)

        if (task?.id) {
          taskIds.push(task.id)
          logger.debug('Task record created', {
            taskId: task.id,
            notionPageId: notionTask.id,
            title: aiTask?.title || parsed.title,
          })
        }
      } catch (error) {
        logger.error('Failed to create task record', error, {
          notionPageId: notionTask.id,
        })
        // Continue processing other tasks even if one fails
      }
    }

    // Update discussion with task IDs
    if (taskIds.length > 0) {
      const { updateTriageDiscussion } = await import(
        '~~/layers/triage/collections/discussions/server/database/queries'
      )

      await updateTriageDiscussion(
        discussionId,
        currentTeamId,
        SYSTEM_USER_ID,
        {
          notionTaskIds: taskIds,
        },
      )

      logger.debug('Discussion updated with task IDs', { taskIds })
    }

    return taskIds
  } catch (error) {
    logger.error('Failed to save task records', error)
    // Don't fail processing if task record creation fails
    return []
  }
}

/**
 * Build discussion thread
 *
 * Fetches the complete thread from the source using the adapter.
 * For testing, you can also provide a thread directly.
 */
async function buildThread(
  parsed: ParsedDiscussion,
  config: AdapterConfig,
  threadInput?: DiscussionThread,
  teamId?: string,
  userMappings?: Map<string, { name: string; notionId: string }>,
): Promise<DiscussionThread> {
  // If thread provided directly, use it (for testing)
  if (threadInput) {
    logger.debug('Using provided thread input')
    return threadInput
  }

  // Fetch thread from source using adapter
  const { getAdapter } = await import('../adapters')
  const adapter = getAdapter(parsed.sourceType)
  const thread = await adapter.fetchThread(parsed.sourceThreadId, config)

  // Use user mappings passed from Stage 2.5 (already loaded once)
  const userIdToMentionMap = userMappings || new Map<string, { name: string; notionId: string }>()
  let handleToMentionMap = new Map<string, { name: string; notionId: string }>() // For Figma @handle mentions

  // For Notion sources, auto-fetch user info if no mappings exist
  if (parsed.sourceType === 'notion' && userIdToMentionMap.size === 0 && config.apiToken) {
    await fetchNotionUsersIntoMap(config.apiToken, userIdToMentionMap)
  }

  // Build handle map for Figma (only if we have user mappings)
  if (userMappings && parsed.sourceType === 'figma' && teamId) {
    handleToMentionMap = await loadFigmaHandleMap(teamId)
  }

  logger.debug('User mappings available for mention conversion', {
    userIdMappings: userIdToMentionMap.size,
    handleMappings: handleToMentionMap.size,
  })

  // Convert user ID mentions to readable names with Notion IDs and filter out bot
  applyMentionConversion(thread, parsed.sourceType, config, userIdToMentionMap, handleToMentionMap)

  // Resolve author IDs to names for display in Notion
  resolveThreadAuthorNames(thread, userIdToMentionMap)

  return thread
}

/**
 * Fetch Notion workspace users and add them to the mention map
 *
 * Used for Notion sources when no user mappings exist so that author IDs
 * can still be resolved to display names. Failures are logged, not thrown.
 */
async function fetchNotionUsersIntoMap(
  apiToken: string,
  userIdToMentionMap: Map<string, { name: string; notionId: string }>,
): Promise<void> {
  try {
    logger.debug('Fetching Notion users for author resolution')
    const NOTION_API_VERSION = '2022-06-28'
    const response = await $fetch<{ results: Array<{ id: string; name?: string; type: string }> }>(
      'https://api.notion.com/v1/users',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      }
    )

    // Build map of Notion user ID -> name
    for (const user of response.results) {
      if (user.name) {
        userIdToMentionMap.set(user.id, {
          name: user.name,
          notionId: user.id, // For Notion, the source ID is the Notion ID
        })
      }
    }
    logger.info('Fetched Notion users for author resolution', {
      userCount: userIdToMentionMap.size,
    })
  } catch (error) {
    logger.warn('Failed to fetch Notion users, will use IDs as author names', { error })
  }
}

/**
 * Load the Figma @handle -> mention data map from stored user mappings
 *
 * Returns an empty map on failure (logged, not thrown).
 */
async function loadFigmaHandleMap(
  teamId: string,
): Promise<Map<string, { name: string; notionId: string }>> {
  const handleToMentionMap = new Map<string, { name: string; notionId: string }>()

  try {
    const { getAllTriageUsers } = await import('~~/layers/triage/collections/users/server/database/queries')
    const allUserMappings = await getAllTriageUsers(teamId)

    for (const mapping of allUserMappings) {
      if (mapping.sourceType === 'figma' && mapping.active && mapping.sourceUserName) {
        const displayName = mapping.notionUserName || mapping.sourceUserName || mapping.sourceUserId
        const mentionData = {
          name: String(displayName),
          notionId: String(mapping.notionUserId)
        }
        handleToMentionMap.set(String(mapping.sourceUserName), mentionData)
      }
    }
  } catch (error) {
    logger.warn('Failed to load Figma handle mappings', { error })
  }

  return handleToMentionMap
}

/**
 * Convert Slack user ID mentions (<@U123ABC456>) to @Name (NotionID)
 * and strip bot mentions entirely
 */
function convertSlackMentionContent(
  content: string,
  botUserId: string | undefined,
  userIdToMentionMap: Map<string, { name: string; notionId: string }>,
): string {
  let converted = content

  // First, remove bot mentions entirely
  if (botUserId) {
    converted = converted.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim()
    // Clean up multiple spaces
    converted = converted.replace(/\s+/g, ' ').trim()
  }

  // Then convert remaining user IDs to @Name (NotionID)
  userIdToMentionMap.forEach((mention, userId) => {
    converted = converted.replace(
      new RegExp(`<@${userId}>`, 'g'),
      `@${mention.name} (${mention.notionId})`
    )
  })

  return converted
}

/**
 * Convert the three Figma mention formats — parentheses @Name (uuid),
 * bracket @[userId:displayName], and plain @handle — to readable names,
 * stripping bot mentions entirely
 */
function convertFigmaMentionContent(
  content: string,
  config: AdapterConfig,
  userIdToMentionMap: Map<string, { name: string; notionId: string }>,
  handleToMentionMap: Map<string, { name: string; notionId: string }>,
): string {
  let converted = content
  const botUserId = config.sourceMetadata?.botUserId
  const botHandle = config.sourceMetadata?.botHandle

  // STEP 1: Handle Figma parentheses format @Name (uuid)
  // This is the actual format seen in Figma comments: @Maarten Lauwaert (a36f9347-1da7-400e-9ac5-06442413f18d)
  const parenMentionRegex = /@([^(@]+?)\s*\(([a-f0-9-]+)\)/gi

  converted = converted.replace(parenMentionRegex, (_match, displayName, userId) => {
    const trimmedName = displayName.trim()

    // Skip bot mentions entirely (check both userId and handle/name)
    if ((botUserId && userId === botUserId) ||
        (botHandle && trimmedName.toLowerCase() === botHandle.toLowerCase())) {
      return '' // Remove bot mention
    }

    // Look up user in mappings by userId (Figma user ID)
    const mappedUser = userIdToMentionMap.get(userId)
    if (mappedUser) {
      return `@${mappedUser.name}`
    }

    // Fallback: just use displayName without the UUID
    return `@${trimmedName}`
  })

  // Clean up multiple spaces from removed bot mentions
  converted = converted.replace(/\s+/g, ' ').trim()

  // STEP 2: Handle Figma bracket format @[userId:displayName]
  // Alternative format that may be returned by Figma API
  const bracketMentionRegex = /@\[([^\]:]+):([^\]]+)\]/g

  converted = converted.replace(bracketMentionRegex, (_match, userId, displayName) => {
    // Skip bot mentions entirely (check both userId and handle)
    if ((botUserId && userId === botUserId) ||
        (botHandle && displayName.toLowerCase() === botHandle.toLowerCase())) {
      return '' // Remove bot mention
    }

    // Look up user in mappings by userId (Figma user ID)
    const mappedUser = userIdToMentionMap.get(userId)
    if (mappedUser) {
      return `@${mappedUser.name} (${mappedUser.notionId})`
    }

    // Fallback: just use displayName (cleaned)
    return `@${displayName.trim()}`
  })

  // Clean up multiple spaces from removed bot mentions
  converted = converted.replace(/\s+/g, ' ').trim()

  // STEP 3: Handle plain @handle format (for email webhook content)
  // First, remove bot mentions entirely (before converting user mentions)
  if (botHandle) {
    // Escape special regex characters in handle
    const escapedBotHandle = botHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match @bothandle with word boundary (case-insensitive)
    const botPattern = new RegExp(`@${escapedBotHandle}(?!\\S)`, 'gi')
    converted = converted.replace(botPattern, '').trim()
    // Clean up multiple spaces
    converted = converted.replace(/\s+/g, ' ').trim()
  }

  // Convert @handle mentions to @Name (just use display name, no ID in output)
  handleToMentionMap.forEach((mention, handle) => {
    // Escape special regex characters in handle
    const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = `@${escapedHandle}(?!\\S)` // Case-insensitive, not followed by non-whitespace

    const regex = new RegExp(pattern, 'gi')
    converted = converted.replace(
      regex,
      `@${mention.name}`
    )
  })

  return converted
}

/**
 * Convert user mentions in a thread's root message and replies to readable
 * names (stripping bot mentions), when conversion applies to the source type
 */
function applyMentionConversion(
  thread: DiscussionThread,
  sourceType: string,
  config: AdapterConfig,
  userIdToMentionMap: Map<string, { name: string; notionId: string }>,
  handleToMentionMap: Map<string, { name: string; notionId: string }>,
): void {
  const botUserId = config.sourceMetadata?.botUserId

  const convertMentions = (content: string): string => {
    if (sourceType === 'slack') {
      // Slack format: <@U123ABC456>
      return convertSlackMentionContent(content, botUserId, userIdToMentionMap)
    } else if (sourceType === 'figma') {
      return convertFigmaMentionContent(content, config, userIdToMentionMap, handleToMentionMap)
    }
    return content
  }

  // Always run conversion for Figma (to strip UUIDs from mentions even without mappings)
  // For other sources, only run if bot or mappings are configured
  const shouldConvert = sourceType === 'figma' ||
    botUserId ||
    userIdToMentionMap.size > 0 ||
    handleToMentionMap.size > 0

  if (shouldConvert) {
    logger.debug('Converting user mentions for AI', {
      sourceType,
      hasBot: !!botUserId,
      mappingCount: userIdToMentionMap.size + handleToMentionMap.size
    })

    // Convert root message
    thread.rootMessage.content = convertMentions(thread.rootMessage.content)

    // Convert all replies
    thread.replies = thread.replies.map((reply: any) => ({
      ...reply,
      content: convertMentions(reply.content)
    }))
  }
}

/**
 * Resolve author IDs to display names on a thread (root message + replies)
 */
function resolveThreadAuthorNames(
  thread: DiscussionThread,
  userIdToMentionMap: Map<string, { name: string; notionId: string }>,
): void {
  if (userIdToMentionMap.size === 0) {
    return
  }

  // Resolve root message author
  const rootAuthorData = userIdToMentionMap.get(thread.rootMessage.authorHandle)
  if (rootAuthorData) {
    thread.rootMessage.authorName = rootAuthorData.name
    logger.debug('Resolved root author', {
      from: thread.rootMessage.authorHandle,
      to: rootAuthorData.name,
    })
  }

  // Resolve reply authors
  thread.replies = thread.replies.map((reply: any) => {
    const replyAuthorData = userIdToMentionMap.get(reply.authorHandle)
    return {
      ...reply,
      authorName: replyAuthorData?.name,
    }
  })

  logger.debug('Resolved author IDs to names', {
    totalAuthors: new Set([
      thread.rootMessage.authorHandle,
      ...thread.replies.map((r: any) => r.authorHandle)
    ]).size,
  })
}

/**
 * Emit a crouton:operation telemetry hook (fire-and-forget)
 */
function emitTriageHook(
  type: string,
  teamId: string | undefined,
  correlationId: string | undefined,
  metadata: Record<string, any>,
): void {
  useNitroApp().hooks.callHook('crouton:operation', {
    type,
    source: 'crouton-triage',
    teamId: teamId ?? undefined,
    correlationId,
    metadata,
  }).catch(() => {})
}

/**
 * Stage 1.5: Deduplication check
 *
 * Checks if we're already processing this sourceThreadId to prevent duplicates
 * from Slack retries. Returns an "already processed" result when a live
 * duplicate exists; deletes the old record (and returns undefined) when a
 * retry is allowed (failed discussions or bootstrap comments).
 */
async function checkDuplicateDiscussion(
  parsed: ParsedDiscussion,
  correlationId?: string,
): Promise<ProcessingResult | undefined> {
  const db = useDB()
  const { triageDiscussions } = await import(
    '~~/layers/triage/collections/discussions/server/database/schema'
  )

  // Check if this looks like a bootstrap comment (before we have the full thread)
  const contentLower = parsed.content.toLowerCase()
  const isLikelyBootstrap = contentLower.includes('user sync') || contentLower.includes('bootstrap')

  const [existingDiscussion] = await db
    .select({ id: triageDiscussions.id, status: triageDiscussions.status })
    .from(triageDiscussions)
    .where(eq(triageDiscussions.sourceThreadId, parsed.sourceThreadId))
    .limit(1)

  if (!existingDiscussion) {
    return undefined
  }

  // Allow retry for failed discussions or bootstrap comments
  const shouldAllowRetry = existingDiscussion.status === 'failed' || isLikelyBootstrap

  if (!shouldAllowRetry) {
    logger.info('Discussion already exists for this thread, skipping duplicate', {
      sourceThreadId: parsed.sourceThreadId,
      existingDiscussionId: existingDiscussion.id,
      existingStatus: existingDiscussion.status,
    })
    // Return a mock result to indicate this was already processed
    return {
      discussionId: existingDiscussion.id,
      aiAnalysis: {
        summary: { summary: 'Already processed', keyPoints: [] },
        taskDetection: { isMultiTask: false, tasks: [] },
        processingTime: 0,
        cached: true,
      },
      notionTasks: [],
      processingTime: 0,
      isMultiTask: false,
      correlationId,
    }
  }

  // Delete the existing failed/bootstrap discussion to allow fresh processing
  logger.info('Allowing retry for discussion', {
    sourceThreadId: parsed.sourceThreadId,
    existingDiscussionId: existingDiscussion.id,
    existingStatus: existingDiscussion.status,
    reason: isLikelyBootstrap ? 'bootstrap_comment' : 'failed_status',
  })

  // Delete the old record to allow fresh processing
  await db
    .delete(triageDiscussions)
    .where(eq(triageDiscussions.id, existingDiscussion.id))

  return undefined
}

/**
 * Stage 2: Flow/Config loading
 *
 * Uses the provided config when given (for testing); otherwise loads the
 * flow (v2 architecture) and resolves the actual team ID from it.
 */
async function resolveFlowConfig(
  parsed: ParsedDiscussion,
  providedConfig?: AdapterConfig,
): Promise<{ config: AdapterConfig | undefined; flowData: FlowWithRelations | undefined; actualTeamId: string }> {
  let config: AdapterConfig | undefined
  let flowData: FlowWithRelations | undefined
  let actualTeamId: string = parsed.teamId

  if (providedConfig) {
    // Use provided config (for testing)
    config = providedConfig
    logger.debug('Using provided config')
  }
  else {
    // Load flow (v2 architecture — sole config loading mechanism)
    flowData = await loadFlow(parsed.teamId, parsed.sourceType, parsed.metadata)
    actualTeamId = flowData.flow.teamId
    logger.info('Loaded flow for processing', {
      flowId: flowData.flow.id,
      flowName: flowData.flow.name,
      inputCount: flowData.inputs.length,
      outputCount: flowData.outputs.length,
    })
  }

  // Update actualTeamId
  if (config && !flowData) {
    actualTeamId = config.teamId
    logger.debug('Resolved team IDs from config', {
      sourceIdentifier: parsed.teamId,
      actualTeamId: config.teamId,
    })
  }
  else if (flowData) {
    actualTeamId = flowData.flow.teamId
    logger.debug('Resolved team IDs from flow', {
      sourceIdentifier: parsed.teamId,
      actualTeamId: flowData.flow.teamId,
    })
  }

  return { config, flowData, actualTeamId }
}

/**
 * Resolve the input token (once, used for all adapter calls)
 *
 * Prefers the connected-account token for flow inputs, falling back to the
 * inline token; legacy configs use their apiToken directly.
 */
async function resolveProcessingToken(
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): Promise<string> {
  let resolvedInputToken = ''
  if (flowData) {
    try {
      const { resolveInputToken } = await import('../utils/tokenResolver')
      resolvedInputToken = await resolveInputToken(flowData.matchedInput, flowData.flow.teamId)
    } catch (error) {
      logger.warn('Failed to resolve input token from account, falling back to inline', { error })
      resolvedInputToken = flowData.matchedInput.apiToken || ''
    }
  } else if (config) {
    resolvedInputToken = config.apiToken || ''
  }
  return resolvedInputToken
}

/**
 * Build an AdapterConfig from a flow's matched input (used for reactions
 * and replies)
 */
function buildFlowAdapterConfig(flowData: FlowWithRelations, apiToken: string): AdapterConfig {
  return {
    id: flowData.matchedInput.id,
    teamId: flowData.flow.teamId,
    sourceType: flowData.matchedInput.sourceType,
    apiToken,
    sourceMetadata: flowData.matchedInput.sourceMetadata,
  } as AdapterConfig
}

/**
 * Stage 2.25: Add the initial "eyes" status reaction to show the bot is
 * processing (best-effort)
 */
async function addInitialStatusReaction(
  parsed: ParsedDiscussion,
  initialReactionConfig: AdapterConfig | undefined,
): Promise<void> {
  // Skip early reaction for sources where threadId isn't fully resolved yet
  // (e.g. email-sourced Figma discussions only have fileKey, not fileKey:commentId)
  // Stage 3 will add the reaction after thread building enriches the threadId
  if (!initialReactionConfig || !parsed.sourceThreadId.includes(':')) {
    return
  }

  try {
    const { getAdapter } = await import('../adapters')
    const adapter = getAdapter(parsed.sourceType)
    await adapter.updateStatus(parsed.sourceThreadId, 'pending', initialReactionConfig)
    logger.debug('Initial status reaction added')
  } catch (error) {
    // Don't fail if initial reaction fails
    logger.warn('Failed to add initial status reaction', { error })
  }
}

/**
 * Determine the source workspace ID used for filtering user mappings
 */
function resolveSourceWorkspaceId(
  parsed: ParsedDiscussion,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): string | undefined {
  if (flowData) {
    // Extract from flow input's sourceMetadata
    return flowData.matchedInput.sourceMetadata?.slackTeamId ||
      flowData.matchedInput.sourceMetadata?.figmaOrgId ||
      flowData.matchedInput.sourceMetadata?.notionWorkspaceId ||
      parsed.metadata?.notionWorkspaceId ||
      parsed.teamId
  }
  if (config) {
    // Extract from legacy config's sourceMetadata
    return config.sourceMetadata?.slackTeamId ||
      config.sourceMetadata?.figmaOrgId ||
      config.sourceMetadata?.notionWorkspaceId ||
      parsed.metadata?.notionWorkspaceId ||
      parsed.teamId
  }
  return undefined
}

/**
 * Stage 2.5: Load user mappings (once, used throughout the pipeline)
 *
 * Returns a sourceUserId -> mention data map filtered by source type,
 * active status, and workspace; undefined when loading fails.
 */
async function loadUserMappings(
  parsed: ParsedDiscussion,
  actualTeamId: string,
  sourceWorkspaceId: string | undefined,
): Promise<Map<string, { name: string; notionId: string }> | undefined> {
  try {
    const { getAllTriageUsers } = await import(
      '~~/layers/triage/collections/users/server/database/queries'
    )
    const allUserMappings = await getAllTriageUsers(actualTeamId)

    const userIdToMentionMap = new Map<string, { name: string; notionId: string }>()

    for (const mapping of allUserMappings) {
      // Filter by sourceType, active status, and sourceWorkspaceId
      // Allow mappings with empty sourceWorkspaceId to match any workspace (global mappings)
      const matchesWorkspace = !sourceWorkspaceId || !mapping.sourceWorkspaceId || mapping.sourceWorkspaceId === sourceWorkspaceId
      if (mapping.sourceType === parsed.sourceType && mapping.active && matchesWorkspace) {
        const displayName = mapping.notionUserName || mapping.sourceUserName || mapping.sourceUserId
        const mentionData = {
          name: String(displayName),
          notionId: String(mapping.notionUserId),
        }
        userIdToMentionMap.set(String(mapping.sourceUserId), mentionData)
      }
    }

    logger.info(`Loaded ${userIdToMentionMap.size} user mappings for ${parsed.sourceType}`, {
      sourceWorkspaceId,
      filtered: !!sourceWorkspaceId,
    })
    return userIdToMentionMap
  }
  catch (error) {
    logger.warn('Failed to load user mappings', { error })
    // Continue without mappings - operations will fallback to IDs
    return undefined
  }
}

/**
 * Create the job record tracking this processing run (best-effort)
 *
 * Returns the job ID, or undefined when creation fails.
 */
async function createJobRecord(
  parsed: ParsedDiscussion,
  actualTeamId: string,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): Promise<string | undefined> {
  try {
    const { createTriageJob } = await import(
      '~~/layers/triage/collections/jobs/server/database/queries'
    )

    const job = await createTriageJob({
      teamId: actualTeamId,
      owner: SYSTEM_USER_ID,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
      discussionId: '', // Will update after discussion is created
      flowInputId: flowData ? flowData.matchedInput.id : (config?.id || ''),
      status: 'processing',
      stage: 'thread_building',
      attempts: 0,
      maxAttempts: 3,
      error: undefined,
      errorStack: undefined,
      startedAt: new Date(),
      completedAt: undefined,
      processingTime: undefined,
      taskIds: [],
      metadata: {
        sourceType: parsed.sourceType,
        sourceThreadId: parsed.sourceThreadId,
        emailSlug: parsed.teamId, // Store original email slug for reference
        startTimestamp: Date.now(),
        flowId: flowData?.flow.id, // Include flow ID if using flows
        inputId: flowData?.matchedInput.id, // Include matched input ID
      },
    })

    const jobId = job?.id
    logger.debug('Job created', {
      jobId,
      teamId: config?.teamId,
    })
    return jobId
  } catch (error) {
    logger.error('Failed to create job record', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    // Don't fail processing if job creation fails
    return undefined
  }
}

/**
 * Cross-link the job and discussion records after both exist (best-effort)
 */
async function linkDiscussionToJob(
  discussionId: string,
  jobId: string | undefined,
  actualTeamId: string,
): Promise<void> {
  if (!jobId || !discussionId) {
    return
  }

  try {
    const { updateTriageJob } = await import(
      '~~/layers/triage/collections/jobs/server/database/queries'
    )

    await updateTriageJob(jobId, actualTeamId, SYSTEM_USER_ID, {
      discussionId,
    })

    // Link discussion to job
    const { updateTriageDiscussion } = await import(
      '~~/layers/triage/collections/discussions/server/database/queries'
    )

    await updateTriageDiscussion(
      discussionId,
      currentTeamId!,
      SYSTEM_USER_ID,
      {
        syncJobId: jobId,
      },
    )

    logger.debug('Linked discussion to job', {
      discussionId,
      jobId,
    })
  } catch (error) {
    logger.error('Failed to link discussion to job', error)
    // Don't fail processing if linking fails
  }
}

/**
 * Build the AdapterConfig used for thread building (flow input or legacy)
 *
 * For Figma inputs, uses the input's name as botHandle if not explicitly set.
 * For Notion inputs, the token may be in sourceMetadata.notionToken instead
 * of apiToken.
 */
function buildThreadConfig(
  resolvedInputToken: string,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): AdapterConfig {
  return flowData
    ? {
        id: flowData.matchedInput.id,
        teamId: flowData.flow.teamId,
        sourceType: flowData.matchedInput.sourceType,
        apiToken: resolvedInputToken || flowData.matchedInput.sourceMetadata?.notionToken || '',
        sourceMetadata: {
          ...flowData.matchedInput.sourceMetadata,
          // Use sourceMetadata botHandle for Figma (the bot account name)
          botHandle: flowData.matchedInput.sourceMetadata?.botHandle || flowData.matchedInput.sourceType,
        },
      } as AdapterConfig
    : config!
}

/**
 * For Figma discussions, rewrite sourceUrl/sourceThreadId with the comment ID
 * discovered during thread building, persist them, and add the "eyes" reaction
 *
 * Mutates `parsed` in place.
 */
async function enrichFigmaThreadReference(
  parsed: ParsedDiscussion,
  thread: DiscussionThread,
  discussionId: string,
  threadBuildConfig: AdapterConfig,
): Promise<void> {
  if (!(parsed.sourceType === 'figma' && thread.id && parsed.metadata?.fileKey)) {
    return
  }

  const fileKey = parsed.metadata.fileKey
  parsed.sourceUrl = `https://www.figma.com/file/${fileKey}#${thread.id}`
  // Update sourceThreadId to include comment ID (format: fileKey:commentId)
  parsed.sourceThreadId = `${fileKey}:${thread.id}`

  logger.debug('Updated Figma URLs', {
    sourceUrl: parsed.sourceUrl,
    sourceThreadId: parsed.sourceThreadId,
  })

  // Update the discussion record with the correct URL and threadId using Crouton query
  const { updateTriageDiscussion } = await import(
    '~~/layers/triage/collections/discussions/server/database/queries'
  )
  await updateTriageDiscussion(
    discussionId,
    currentTeamId!,
    SYSTEM_USER_ID,
    {
      sourceUrl: parsed.sourceUrl,
      sourceThreadId: parsed.sourceThreadId,
    },
  )

  // Now that we have the comment ID, add the "eyes" emoji reaction
  try {
    const { getAdapter } = await import('../adapters')
    const adapter = getAdapter(parsed.sourceType)
    await adapter.updateStatus(parsed.sourceThreadId, 'pending', threadBuildConfig)
    logger.debug('Added eyes emoji to Figma comment', { commentId: thread.id })
  } catch (error) {
    logger.warn('Failed to add eyes emoji to Figma comment', { error })
    // Don't fail the whole process for emoji failures
  }
}

/**
 * Stage 4: AI analysis (summary + task detection)
 *
 * Returns a mock analysis when skipAI is set (for testing).
 */
async function runAiAnalysis(
  parsed: ParsedDiscussion,
  thread: DiscussionThread,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
  skipAI?: boolean,
): Promise<AIAnalysisResult> {
  if (skipAI) {
    // Mock AI analysis for testing
    return {
      summary: {
        summary: 'Mock summary',
        keyPoints: ['Mock point 1'],
      },
      taskDetection: {
        isMultiTask: false,
        tasks: [{
          title: parsed.title,
          description: parsed.content,
        }],
      },
      processingTime: 0,
      cached: false,
    }
  }

  // Get AI settings from flow or config
  const customSummaryPrompt = flowData?.flow.aiSummaryPrompt || (config as any)?.aiSummaryPrompt || undefined
  const customTaskPrompt = flowData?.flow.aiTaskPrompt || (config as any)?.aiTaskPrompt || undefined
  const availableDomains = flowData?.flow.availableDomains || undefined

  logger.debug('Using AI settings', {
    hasSummaryPrompt: !!customSummaryPrompt,
    hasTaskPrompt: !!customTaskPrompt,
    availableDomains,
  })

  const aiAnalysis = await analyzeDiscussion(thread, {
    sourceType: parsed.sourceType,
    customSummaryPrompt,
    customTaskPrompt,
    availableDomains, // Pass available domains for domain detection
  })

  logger.info('AI analysis complete', {
    taskCount: aiAnalysis.taskDetection.tasks.length,
    isMultiTask: aiAnalysis.taskDetection.isMultiTask,
    cached: aiAnalysis.cached,
  })

  return aiAnalysis
}

/**
 * Resolve the workspace identifier used to store bootstrap-discovered users
 *
 * Uses the same sourceWorkspaceId semantics as Stage 2.5:
 * for Slack the slackTeamId from sourceMetadata, for Figma the emailSlug
 * from the flow input or parsed metadata.
 */
function resolveBootstrapWorkspaceId(
  parsed: ParsedDiscussion,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): string {
  if (parsed.sourceType === 'slack') {
    return flowData?.matchedInput?.sourceMetadata?.slackTeamId
      || config?.sourceMetadata?.slackTeamId
      || ''
  }
  if (parsed.sourceType === 'figma') {
    // For Figma, use emailSlug from flow input or parsed metadata
    return flowData?.matchedInput?.emailSlug
      || parsed.metadata?.emailSlug
      || ''
  }
  return ''
}

/**
 * Persist users discovered in a bootstrap comment as pending user mappings
 */
async function storeBootstrapUsers(
  parsed: ParsedDiscussion,
  bootstrapResult: BootstrapCommentResult,
  actualTeamId: string,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): Promise<void> {
  const bootstrapSourceWorkspaceId = resolveBootstrapWorkspaceId(parsed, flowData, config)

  if (bootstrapSourceWorkspaceId) {
    const newMappingsCount = await storeDiscoveredUsers(
      bootstrapResult.mentionedUsers,
      actualTeamId,
      parsed.sourceType,
      bootstrapSourceWorkspaceId,
    )
    logger.info('Stored discovered users from bootstrap comment', {
      newMappingsCount,
      totalMentioned: bootstrapResult.mentionedUsers.length,
      sourceWorkspaceId: bootstrapSourceWorkspaceId,
    })
  } else {
    logger.warn('Cannot store discovered users - sourceWorkspaceId not found', {
      sourceType: parsed.sourceType,
      hasFlowData: !!flowData,
      hasConfig: !!config,
    })
  }
}

/**
 * Post the bootstrap reply back to the source thread (best-effort)
 */
async function sendBootstrapReply(
  parsed: ParsedDiscussion,
  bootstrapResult: BootstrapCommentResult,
  replyConfig: AdapterConfig,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): Promise<void> {
  try {
    const { getAdapter } = await import('../adapters')
    const adapter = getAdapter(parsed.sourceType)

    // Remove the initial "eyes" reaction if present
    if ('removeReaction' in adapter && typeof adapter.removeReaction === 'function') {
      await adapter.removeReaction(parsed.sourceThreadId, 'eyes', replyConfig)
    }

    // Build bootstrap response message with personality
    const userCount = bootstrapResult.mentionedUsers.length
    const replyPersonality = flowData?.flow.replyPersonality || null
    const encryptedBootstrapKey = flowData?.flow.anthropicApiKey
    const anthropicApiKey = encryptedBootstrapKey
      ? await decryptSecret(encryptedBootstrapKey)
      : (config as any)?.anthropicApiKey
    const personalityIcon = flowData?.flow.personalityIcon || undefined
    const bootstrapMessage = await generateBootstrapMessage(userCount, replyPersonality, anthropicApiKey, personalityIcon)

    await adapter.postReply(parsed.sourceThreadId, bootstrapMessage, replyConfig)
    await adapter.updateStatus(parsed.sourceThreadId, 'completed', replyConfig)

    logger.info('Bootstrap reply sent to source', {
      userCount,
      sourceType: parsed.sourceType,
    })
  } catch (error) {
    logger.warn('Failed to send bootstrap reply to source', { error })
    // Don't fail the process if reply fails
  }
}

/**
 * Mark the job completed for a bootstrap comment (best-effort)
 */
async function finalizeBootstrapJob(
  jobId: string,
  actualTeamId: string,
  processingTime: number,
  bootstrapResult: BootstrapCommentResult,
): Promise<void> {
  try {
    const { updateTriageJob } = await import(
      '~~/layers/triage/collections/jobs/server/database/queries'
    )

    await updateTriageJob(jobId, actualTeamId, SYSTEM_USER_ID, {
      status: 'completed',
      completedAt: new Date(),
      processingTime,
      metadata: {
        isBootstrap: true,
        bootstrapReason: bootstrapResult.reason,
        mentionedUsers: bootstrapResult.mentionedUsers,
      },
    })
  } catch (error) {
    logger.warn('Failed to finalize bootstrap job', { error })
  }
}

/**
 * Handle a bootstrap/user-sync comment: store discovered users, reply to
 * the source, finalize the job, and return the early processing result
 * (bootstrap comments never create tasks)
 */
async function handleBootstrapComment(ctx: {
  parsed: ParsedDiscussion
  bootstrapResult: BootstrapCommentResult
  discussionId: string
  jobId: string | undefined
  actualTeamId: string
  flowData?: FlowWithRelations
  config?: AdapterConfig
  resolvedInputToken: string
  aiAnalysis: AIAnalysisResult
  startTime: number
  correlationId?: string
}): Promise<ProcessingResult> {
  const { parsed, bootstrapResult, discussionId, jobId, actualTeamId, flowData, config, resolvedInputToken, aiAnalysis, startTime, correlationId } = ctx

  logger.info('Bootstrap comment detected - skipping Notion task creation', {
    reason: bootstrapResult.reason,
    mentionedUserCount: bootstrapResult.mentionedUsers.length,
    mentionedUsers: bootstrapResult.mentionedUsers.map((u) => u.displayName),
    sourceType: parsed.sourceType,
    discussionId,
  })

  // Store discovered users as pending mappings
  if (bootstrapResult.mentionedUsers.length > 0) {
    await storeBootstrapUsers(parsed, bootstrapResult, actualTeamId, flowData, config)
  }

  // Update discussion status to indicate bootstrap processing
  await updateDiscussionStatus(discussionId, 'completed')

  // Build config for posting reply (from flow or legacy config)
  const replyConfig = flowData
    ? buildFlowAdapterConfig(flowData, resolvedInputToken)
    : config!

  // Post reply to source with discovered users info
  await sendBootstrapReply(parsed, bootstrapResult, replyConfig, flowData, config)

  // Finalize job for bootstrap
  if (jobId) {
    await finalizeBootstrapJob(jobId, actualTeamId, Date.now() - startTime, bootstrapResult)
  }

  // Return early - no task creation for bootstrap comments
  return {
    discussionId,
    aiAnalysis,
    notionTasks: [], // No tasks created for bootstrap
    processingTime: Date.now() - startTime,
    isMultiTask: false,
    correlationId,
  }
}

/**
 * Build source metadata for linking author names and @mentions to the
 * source platform in created Notion tasks
 */
function buildSourceMetadata(
  parsed: ParsedDiscussion,
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): SourceMetadata | undefined {
  const sourceType = parsed.sourceType as 'figma' | 'slack' | 'notion'

  if (sourceType === 'figma') {
    const fileKey = parsed.metadata?.fileKey
    if (fileKey) {
      return { sourceType, fileKey }
    }
  } else if (sourceType === 'slack') {
    const channelId = flowData?.matchedInput?.sourceMetadata?.channelId
      || config?.sourceMetadata?.channelId
      || parsed.metadata?.channelId
    const slackTeamId = flowData?.matchedInput?.sourceMetadata?.slackTeamId
      || config?.sourceMetadata?.slackTeamId
      || parsed.teamId
    if (channelId && slackTeamId) {
      return { sourceType, channelId, slackTeamId }
    }
  } else if (sourceType === 'notion') {
    // For Notion, extract parentId (page ID) from metadata
    const pageId = parsed.metadata?.parentId
    if (pageId) {
      return { sourceType, pageId }
    }
  }
  return undefined
}

/**
 * Create a single task in one Notion flow output (best-effort)
 *
 * Returns the created task, or undefined when creation fails so the caller
 * can continue with other outputs.
 */
async function createTaskInNotionOutput(
  task: AIAnalysisResult['taskDetection']['tasks'][number],
  output: FlowOutput,
  thread: DiscussionThread,
  aiAnalysis: AIAnalysisResult,
  parsed: ParsedDiscussion,
  actualTeamId: string,
  notionUserMappings: Map<string, string>,
  sourceMetadata: SourceMetadata | undefined,
): Promise<NotionTaskResult | undefined> {
  try {
    // Extract Notion config from output
    const { config: notionConfig, fieldMapping } = await createNotionConfigFromOutput(
      output,
      parsed.sourceType,
      parsed.sourceUrl,
      actualTeamId,
    )

    logger.info('Creating task in output', {
      outputId: output.id,
      outputType: output.outputType,
      taskTitle: task.title,
    })

    const result = await createNotionTask(
      task,
      thread,
      aiAnalysis.summary,
      notionConfig,
      notionUserMappings,
      fieldMapping,
      notionUserMappings,
      sourceMetadata,
    )

    logger.info('Task created successfully in output', {
      outputId: output.id,
      outputType: output.outputType,
      notionTaskId: result.id,
    })

    return result
  }
  catch (error) {
    logger.error('Failed to create task in output', error, {
      outputId: output.id,
      outputType: output.outputType,
      taskTitle: task.title,
    })
    // Continue with other outputs even if one fails
    return undefined
  }
}

/**
 * Flows architecture: route each detected task to matching outputs by
 * domain and create it in every matched Notion output
 */
async function createTasksViaFlows(
  tasks: AIAnalysisResult['taskDetection']['tasks'],
  flowData: FlowWithRelations,
  thread: DiscussionThread,
  aiAnalysis: AIAnalysisResult,
  parsed: ParsedDiscussion,
  actualTeamId: string,
  notionUserMappings: Map<string, string>,
  sourceMetadata: SourceMetadata | undefined,
): Promise<NotionTaskResult[]> {
  logger.info('Processing with flows architecture', {
    flowId: flowData.flow.id,
    taskCount: tasks.length,
    outputCount: flowData.outputs.length,
  })

  const notionTasks: NotionTaskResult[] = []

  // Process each task
  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex]
    if (!task) {
      logger.warn('Task is undefined, skipping', { taskIndex })
      continue
    }

    // Route task to matching outputs based on domain
    const matchedOutputs = routeTaskToOutputs(task, flowData.outputs)

    logger.info('Task routed to outputs', {
      taskIndex,
      taskDomain: task.domain,
      matchedOutputCount: matchedOutputs.length,
      outputTypes: matchedOutputs.map(o => o.outputType),
    })

    // Create task in all matched outputs
    for (const output of matchedOutputs) {
      if (output.outputType !== 'notion') {
        logger.warn('Non-Notion output types not yet supported', {
          outputType: output.outputType,
          outputId: output.id,
        })
        continue
      }

      const result = await createTaskInNotionOutput(
        task,
        output,
        thread,
        aiAnalysis,
        parsed,
        actualTeamId,
        notionUserMappings,
        sourceMetadata,
      )
      if (result) {
        notionTasks.push(result)
      }
    }
  }

  logger.info('All tasks processed with flows', {
    totalTasksCreated: notionTasks.length,
    taskIds: notionTasks.map(t => t.id),
  })

  return notionTasks
}

/**
 * Legacy config: create task(s) in the single configured Notion database
 * (backward compatibility)
 */
async function createTasksViaLegacyConfig(
  tasks: AIAnalysisResult['taskDetection']['tasks'],
  config: AdapterConfig,
  thread: DiscussionThread,
  aiAnalysis: AIAnalysisResult,
  parsed: ParsedDiscussion,
  notionUserMappings: Map<string, string>,
  sourceMetadata: SourceMetadata | undefined,
): Promise<NotionTaskResult[]> {
  const notionConfig: NotionTaskConfig = {
    databaseId: (config as any).notionDatabaseId,
    apiKey: (config as any).notionToken,
    sourceType: parsed.sourceType,
    sourceUrl: parsed.sourceUrl,
  }

  const fieldMapping = (config as any).notionFieldMapping || {}

  let notionTasks: NotionTaskResult[] = []

  if (tasks.length === 1) {
    // Single task
    const task = tasks[0]
    if (!task) {
      logger.warn('Task is undefined, skipping')
    }
    else {
      logger.info('Creating single Notion task (legacy config)')

      const result = await createNotionTask(
        task,
        thread,
        aiAnalysis.summary,
        notionConfig,
        notionUserMappings,
        fieldMapping,
        notionUserMappings,
        sourceMetadata,
      )

      notionTasks.push(result)
    }
  }
  else {
    // Multiple tasks
    logger.info('Creating multiple Notion tasks (legacy config)', { count: tasks.length })

    notionTasks = await createNotionTasks(
      tasks,
      thread,
      aiAnalysis.summary,
      notionConfig,
      notionUserMappings,
      fieldMapping,
      notionUserMappings,
      sourceMetadata,
    )
  }

  logger.info('Notion tasks created (legacy)', {
    count: notionTasks.length,
    ids: notionTasks.map(t => t.id),
  })

  return notionTasks
}

/**
 * Stage 5: Task creation
 *
 * Converts user mappings for the Notion API, builds source metadata,
 * creates tasks via the flows architecture or legacy config, and saves
 * the resulting task records to the database.
 */
async function runTaskCreationStage(ctx: {
  parsed: ParsedDiscussion
  thread: DiscussionThread
  aiAnalysis: AIAnalysisResult
  actualTeamId: string
  discussionId: string
  jobId: string | undefined
  flowData?: FlowWithRelations
  config?: AdapterConfig
  userMappings?: Map<string, { name: string; notionId: string }>
}): Promise<NotionTaskResult[]> {
  const { parsed, thread, aiAnalysis, actualTeamId, discussionId, jobId, flowData, config, userMappings } = ctx

  // Use user mappings from Stage 2.5 (already loaded once)
  // Convert to simple userId -> notionId map for Notion API
  const notionUserMappings = new Map<string, string>()
  if (userMappings) {
    for (const [userId, data] of userMappings.entries()) {
      notionUserMappings.set(userId, data.notionId)
    }
  }

  logger.debug('User mappings available for Notion tasks', {
    active: notionUserMappings.size,
    sourceType: parsed.sourceType
  })

  const tasks = aiAnalysis.taskDetection.tasks

  const sourceMetadata = buildSourceMetadata(parsed, flowData, config)

  logger.debug('Source metadata for platform linking', {
    sourceMetadata,
    hasMetadata: !!sourceMetadata,
  })

  let notionTasks: NotionTaskResult[] = []

  if (tasks.length === 0) {
    logger.info('No tasks detected, skipping Notion creation')
  }
  else if (flowData) {
    notionTasks = await createTasksViaFlows(tasks, flowData, thread, aiAnalysis, parsed, actualTeamId, notionUserMappings, sourceMetadata)
  }
  else if (config) {
    notionTasks = await createTasksViaLegacyConfig(tasks, config, thread, aiAnalysis, parsed, notionUserMappings, sourceMetadata)
  }

  // Save task records to database
  if (notionTasks.length > 0 && discussionId && jobId) {
    await saveTaskRecords(
      notionTasks,
      aiAnalysis.taskDetection.tasks,
      discussionId,
      jobId,
      parsed,
    )
  }

  return notionTasks
}

/**
 * Stage 6: Send the completion notification back to the source thread
 * (best-effort)
 *
 * Uses threadBuildConfig which works with both flows and legacy configs.
 */
async function sendCompletionNotification(
  parsed: ParsedDiscussion,
  threadBuildConfig: AdapterConfig,
  notionTasks: NotionTaskResult[],
  flowData?: FlowWithRelations,
  config?: AdapterConfig,
): Promise<void> {
  try {
    const { getAdapter } = await import('../adapters')
    const adapter = getAdapter(parsed.sourceType)

    // Remove the initial "eyes" reaction
    if ('removeReaction' in adapter && typeof adapter.removeReaction === 'function') {
      await adapter.removeReaction(parsed.sourceThreadId, 'eyes', threadBuildConfig)
    }

    // Build confirmation message with personality
    const replyPersonality = flowData?.flow.replyPersonality || null
    const encryptedConfirmKey = flowData?.flow.anthropicApiKey
    const anthropicApiKey = encryptedConfirmKey
      ? await decryptSecret(encryptedConfirmKey)
      : (config as any)?.anthropicApiKey
    const personalityIcon = flowData?.flow.personalityIcon || undefined
    const confirmationMessage = await generateReplyMessage(notionTasks, replyPersonality, anthropicApiKey, personalityIcon, parsed.sourceType)

    // Post reply to the thread
    await adapter.postReply(parsed.sourceThreadId, confirmationMessage, threadBuildConfig)

    // Update status with completed emoji/reaction
    await adapter.updateStatus(parsed.sourceThreadId, 'completed', threadBuildConfig)

    logger.info('Notification sent to source', {
      sourceType: parsed.sourceType,
      taskCount: notionTasks.length,
    })
  } catch (error) {
    // Don't fail the entire process if notification fails
    logger.error('Failed to send notification to source', error)
  }
}

/**
 * Mark the job completed after successful processing (best-effort)
 */
async function finalizeJobSuccess(
  jobId: string | undefined,
  actualTeamId: string,
  processingTime: number,
  notionTasks: NotionTaskResult[],
): Promise<void> {
  if (!jobId) {
    return
  }

  try {
    const { updateTriageJob } = await import(
      '~~/layers/triage/collections/jobs/server/database/queries'
    )

    await updateTriageJob(jobId, actualTeamId, SYSTEM_USER_ID, {
      status: 'completed',
      completedAt: new Date(),
      processingTime,
      taskIds: notionTasks.map(t => t.id),
    })

    logger.debug('Job finalized', {
      jobId,
      processingTime,
    })
  } catch (error) {
    logger.error('Failed to finalize job', error)
    // Don't fail processing if job finalization fails
  }
}

/**
 * Handle a processing failure: mark discussion + job as failed, emit
 * failure telemetry, and rethrow as a ProcessingError
 */
async function handleProcessingFailure(
  error: unknown,
  ctx: {
    parsed: ParsedDiscussion
    discussionId: string | undefined
    jobId: string | undefined
    actualTeamId: string
    startTime: number
    correlationId?: string
  },
): Promise<never> {
  const { parsed, discussionId, jobId, actualTeamId, startTime, correlationId } = ctx

  logger.error('Processing failed', error)

  // Update discussion status to failed
  if (discussionId) {
    await updateDiscussionStatus(
      discussionId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }

  // Finalize job (failure)
  if (jobId) {
    try {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorStack = error instanceof Error ? error.stack : undefined
      const processingTime = Date.now() - startTime

      const { updateTriageJob } = await import(
        '~~/layers/triage/collections/jobs/server/database/queries'
      )

      await updateTriageJob(jobId, actualTeamId, SYSTEM_USER_ID, {
        status: 'failed',
        completedAt: new Date(),
        processingTime,
        error: errorMessage,
        errorStack: errorStack || undefined,
      })

      logger.warn('Job marked as failed', {
        jobId,
        error: errorMessage,
      })
    } catch (updateError) {
      logger.error('Failed to update job with error', { updateError })
      // Don't fail processing if job update fails
    }
  }

  // Emit failure telemetry
  emitTriageHook('triage:discussion:processed', actualTeamId, correlationId, {
    totalDuration: Date.now() - startTime,
    success: false,
    sourceType: parsed.sourceType,
    errorStage: error instanceof ProcessingError ? error.stage : 'unknown',
  })

  // Wrap error if not already a ProcessingError
  if (error instanceof ProcessingError) {
    throw error
  }

  throw new ProcessingError(
    error instanceof Error ? error.message : 'Unknown error',
    'unknown',
    { originalError: error },
    true, // Assume retryable by default
  )
}

/**
 * Stage 3: Thread building
 *
 * Updates discussion/job status, builds the thread via the adapter (or uses
 * the provided test thread), emits stage telemetry, refreshes discussion
 * metadata from the built thread, and enriches Figma thread references.
 */
async function runThreadBuildingStage(ctx: {
  parsed: ParsedDiscussion
  threadInput?: DiscussionThread
  threadBuildConfig: AdapterConfig
  discussionId: string
  jobId: string | undefined
  actualTeamId: string
  userMappings?: Map<string, { name: string; notionId: string }>
  correlationId?: string
}): Promise<DiscussionThread> {
  const { parsed, threadInput, threadBuildConfig, discussionId, jobId, actualTeamId, userMappings, correlationId } = ctx

  await updateDiscussionStatus(discussionId, 'processing')
  await updateJobStatus(jobId, actualTeamId, {
    stage: 'thread_building',
  })

  const stageThreadStart = Date.now()
  const thread = await buildThread(parsed, threadBuildConfig, threadInput, actualTeamId, userMappings)
  logger.info('Thread built', {
    id: thread.id,
    messages: thread.replies.length + 1,
    participants: thread.participants.length,
  })
  emitTriageHook('triage:stage:completed', actualTeamId, correlationId, {
    stage: 'thread-building',
    duration: Date.now() - stageThreadStart,
    success: true,
  })

  // Update discussion metadata with correct values from thread
  // This fixes the issue where initial save had placeholder email addresses
  logger.info('Stage 3.5: Updating discussion metadata...')
  await updateDiscussionMetadata(discussionId, thread)
  logger.info('Discussion metadata updated successfully')

  // Update sourceUrl and sourceThreadId with comment ID for Figma
  await enrichFigmaThreadReference(parsed, thread, discussionId, threadBuildConfig)

  return thread
}

/**
 * Stage 4: AI analysis, with the job stage update and stage telemetry
 */
async function runAiAnalysisStage(
  parsed: ParsedDiscussion,
  thread: DiscussionThread,
  flowData: FlowWithRelations | undefined,
  config: AdapterConfig | undefined,
  skipAI: boolean | undefined,
  jobId: string | undefined,
  actualTeamId: string,
  correlationId: string | undefined,
): Promise<AIAnalysisResult> {
  logger.info('Stage 4: Starting AI Analysis...')
  await updateJobStatus(jobId, actualTeamId, {
    stage: 'ai_analysis',
  })

  const stageAiStart = Date.now()
  const aiAnalysis = await runAiAnalysis(parsed, thread, flowData, config, skipAI)

  emitTriageHook('triage:stage:completed', actualTeamId, correlationId, {
    stage: 'ai-analysis',
    duration: Date.now() - stageAiStart,
    success: true,
    taskCount: aiAnalysis.taskDetection.tasks.length,
    isMultiTask: aiAnalysis.taskDetection.isMultiTask,
    cached: aiAnalysis.cached,
  })

  return aiAnalysis
}

/**
 * Stages 5.5 + 6: emit task-creation telemetry, persist results, mark the
 * discussion completed, notify the source, finalize the job, and build the
 * successful processing result
 */
async function finalizeSuccessfulProcessing(ctx: {
  parsed: ParsedDiscussion
  thread: DiscussionThread
  threadBuildConfig: AdapterConfig
  aiAnalysis: AIAnalysisResult
  notionTasks: NotionTaskResult[]
  discussionId: string
  jobId: string | undefined
  actualTeamId: string
  flowData?: FlowWithRelations
  config?: AdapterConfig
  startTime: number
  correlationId?: string
}): Promise<ProcessingResult> {
  const { parsed, thread, threadBuildConfig, aiAnalysis, notionTasks, discussionId, jobId, actualTeamId, flowData, config, startTime, correlationId } = ctx

  // Emit task creation telemetry
  if (notionTasks.length > 0) {
    emitTriageHook('triage:stage:completed', actualTeamId, correlationId, {
      stage: 'notion-creation',
      success: true,
      taskCount: notionTasks.length,
    })
  }

  await updateJobStatus(jobId, actualTeamId, {
    stage: 'notification',
  })

  // Update discussion with results
  await updateDiscussionResults(
    discussionId,
    thread,
    aiAnalysis,
    notionTasks,
  )

  // Mark as completed
  await updateDiscussionStatus(discussionId, 'completed')

  // Send notification back to source
  await sendCompletionNotification(parsed, threadBuildConfig, notionTasks, flowData, config)

  const processingTime = Date.now() - startTime

  await finalizeJobSuccess(jobId, actualTeamId, processingTime, notionTasks)

  logger.info('Processing complete', {
    discussionId,
    processingTime,
    taskCount: notionTasks.length,
  })

  emitTriageHook('triage:discussion:processed', actualTeamId, correlationId, {
    totalDuration: processingTime,
    success: true,
    taskCount: notionTasks.length,
    isMultiTask: aiAnalysis.taskDetection.isMultiTask,
    sourceType: parsed.sourceType,
  })

  return {
    discussionId,
    aiAnalysis,
    notionTasks,
    processingTime,
    isMultiTask: aiAnalysis.taskDetection.isMultiTask,
    correlationId,
  }
}

/**
 * Process a discussion through the complete pipeline
 *
 * @param parsed - Parsed discussion from adapter or manual input
 * @param options - Processing options
 * @returns Processing result with discussion ID and created tasks
 *
 * @example
 * ```typescript
 * // With direct thread input (Phase 2 - for testing)
 * const result = await processDiscussion(parsed, {
 *   thread: mockThread,
 *   config: mockConfig
 * })
 *
 * // With adapter (Phase 3+)
 * const result = await processDiscussion(parsed)
 * // Will use adapter to fetch thread from source
 * ```
 */
export async function processDiscussion(
  parsed: ParsedDiscussion,
  options: {
    /** Direct thread input (for testing/Phase 2) */
    thread?: DiscussionThread
    /** Source config (for testing/Phase 2) */
    config?: AdapterConfig
    /** Skip AI analysis (for testing) */
    skipAI?: boolean
    /** Skip Notion task creation (for testing) */
    skipNotion?: boolean
    /** Correlation ID for linking all pipeline stages of a single request */
    correlationId?: string
  } = {},
): Promise<ProcessingResult> {
  const startTime = Date.now()
  let discussionId: string | undefined
  let jobId: string | undefined
  let actualTeamId: string = parsed.teamId // Will be updated to config.teamId after config loads
  const correlationId = options.correlationId

  logger.info('Processing discussion', {
    sourceType: parsed.sourceType,
    sourceThreadId: parsed.sourceThreadId,
    title: parsed.title,
    correlationId,
  })

  // Note: Job creation moved to after config loading to get correct teamId

  try {
    // STAGE 1: Validation
    validateParsedDiscussion(parsed)

    // STAGE 1.5: Deduplication check (failed discussions and bootstrap
    // comments are allowed to retry; anything else short-circuits)
    const duplicateResult = await checkDuplicateDiscussion(parsed, correlationId)
    if (duplicateResult) {
      return duplicateResult
    }

    // STAGE 2: Flow/Config loading
    const { config, flowData, actualTeamId: resolvedTeamId } = await resolveFlowConfig(parsed, options.config)
    actualTeamId = resolvedTeamId

    // Resolve input token (once, used for all adapter calls)
    const resolvedInputToken = await resolveProcessingToken(flowData, config)

    // STAGE 2.25: Add the "eyes" reaction to show the bot is processing
    const initialReactionConfig = flowData
      ? buildFlowAdapterConfig(flowData, resolvedInputToken)
      : config
    await addInitialStatusReaction(parsed, initialReactionConfig)

    // STAGE 2.5: Load user mappings (once, used throughout the pipeline)
    logger.info('Stage 2.5: Loading User Mappings')
    const sourceWorkspaceId = resolveSourceWorkspaceId(parsed, flowData, config)
    const userMappings = await loadUserMappings(parsed, actualTeamId, sourceWorkspaceId)

    // Create job record (after config loaded to get correct teamId),
    // save the discussion record with the actual team ID, and link them
    jobId = await createJobRecord(parsed, actualTeamId, flowData, config)
    const inputId = flowData ? flowData.matchedInput.id : (config?.id || '')
    discussionId = await saveDiscussion(parsed, inputId, actualTeamId, 'processing')
    await linkDiscussionToJob(discussionId, jobId, actualTeamId)

    // STAGE 3: Thread building (with either flow input config or legacy config)
    const threadBuildConfig = buildThreadConfig(resolvedInputToken, flowData, config)
    const thread = await runThreadBuildingStage({
      parsed, threadInput: options.thread, threadBuildConfig,
      discussionId, jobId, actualTeamId, userMappings, correlationId,
    })

    // STAGE 4: AI analysis
    const aiAnalysis = await runAiAnalysisStage(parsed, thread, flowData, config, options.skipAI, jobId, actualTeamId, correlationId)

    // STAGE 5: Task creation — bootstrap/user-sync comments skip it and
    // store discovered users instead
    await updateDiscussionStatus(discussionId, 'analyzed')
    await updateJobStatus(jobId, actualTeamId, { stage: 'task_creation' })

    const bootstrapResult = isBootstrapComment(thread, parsed.sourceType, parsed.content)
    if (bootstrapResult.isBootstrap) {
      return await handleBootstrapComment({
        parsed, bootstrapResult, discussionId, jobId, actualTeamId,
        flowData, config, resolvedInputToken, aiAnalysis, startTime, correlationId,
      })
    }

    let notionTasks: NotionTaskResult[] = []
    const aiEnabled = flowData?.flow.aiEnabled ?? (config as any)?.aiEnabled ?? false

    if (!options.skipNotion && aiEnabled) {
      notionTasks = await runTaskCreationStage({
        parsed, thread, aiAnalysis, actualTeamId,
        discussionId, jobId, flowData, config, userMappings,
      })
    }
    else {
      logger.info('Skipping Notion task creation')
    }

    // STAGES 5.5 + 6: telemetry, results, notification, job finalization
    return await finalizeSuccessfulProcessing({
      parsed, thread, threadBuildConfig, aiAnalysis, notionTasks,
      discussionId, jobId, actualTeamId, flowData, config, startTime, correlationId,
    })
  }
  catch (error) {
    return await handleProcessingFailure(error, {
      parsed,
      discussionId,
      jobId,
      actualTeamId,
      startTime,
      correlationId,
    })
  }
}

/**
 * Process an existing discussion by ID
 *
 * Useful for reprocessing or manual triggers from Admin UI.
 */
export async function processDiscussionById(
  discussionId: string,
): Promise<ProcessingResult> {
  logger.info('Processing discussion by ID', { discussionId })

  // TODO Phase 3: Load discussion from database
  // const discussion = await loadDiscussion(discussionId)
  //
  // const parsed: ParsedDiscussion = {
  //   sourceType: discussion.sourceType,
  //   sourceThreadId: discussion.sourceThreadId,
  //   sourceUrl: discussion.sourceUrl,
  //   teamId: discussion.teamId,
  //   authorHandle: discussion.authorHandle,
  //   title: discussion.title,
  //   content: discussion.content,
  //   participants: discussion.participants || [],
  //   timestamp: discussion.createdAt,
  //   metadata: discussion.metadata || {},
  // }
  //
  // return await processDiscussion(parsed)

  throw new ProcessingError(
    'processDiscussionById not yet implemented (Phase 3+)',
    'load_discussion',
    { discussionId },
    false,
  )
}

/**
 * Retry a failed discussion
 *
 * Loads failed discussion and attempts to reprocess.
 */
export async function retryFailedDiscussion(
  discussionId: string,
): Promise<ProcessingResult> {
  logger.info('Retrying failed discussion', { discussionId })

  return await retryWithBackoff(
    () => processDiscussionById(discussionId),
    {
      maxAttempts: 3,
      baseDelay: 2000,
      maxDelay: 30000,
    },
  )
}


/**
 * Update job record with new status/stage/metadata
 *
 * Best-effort updates - logs warnings but doesn't fail processing.
 */
async function updateJobStatus(
  jobId: string | undefined,
  teamId: string,
  updates: {
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying'
    stage?: 'ingestion' | 'thread_building' | 'ai_analysis' | 'task_creation' | 'notification'
    error?: string
    errorStack?: string
    metadata?: Record<string, any>
  },
): Promise<void> {
  if (!jobId) {
    logger.warn('Cannot update job: jobId is undefined')
    return
  }

  try {
    const { updateTriageJob } = await import(
      '~~/layers/triage/collections/jobs/server/database/queries'
    )

    await updateTriageJob(jobId, teamId, SYSTEM_USER_ID, updates)

    logger.debug('Job updated', {
      jobId,
      status: updates.status,
      stage: updates.stage,
    })
  } catch (error) {
    logger.error('Failed to update job', error)
    // Don't fail processing if job update fails
  }
}
