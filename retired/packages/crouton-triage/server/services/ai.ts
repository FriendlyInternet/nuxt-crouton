/**
 * AI Service - Claude AI Integration with Map-based Caching
 *
 * Provides:
 * - Discussion summarization
 * - Multi-task detection
 * - In-memory caching (Map-based for MVP)
 * - Retry logic with exponential backoff
 *
 * For MVP we use Map-based caching (single-server deployment).
 * In Phase 6, this can be upgraded to KV caching for multi-region deployment.
 *
 * Uses @fyit/crouton-ai for AI provider access.
 */

import { generateText } from 'ai'
import type {
  AIAnalysisOptions,
  AIAnalysisResult,
  AISummary,
  CacheEntry,
  DiscussionThread,
  TaskDetectionResult,
} from '../../app/types'
import { retryWithBackoff } from '../utils/retry'
import { logger } from '../utils/logger'

/**
 * In-memory cache for AI responses
 * Key: Hash of thread content
 * Value: Cached analysis with timestamp
 */
const analysisCache = new Map<string, CacheEntry<AIAnalysisResult>>()

/**
 * Default cache TTL: 1 hour (3600000ms)
 * Balances API cost savings with data freshness
 */
const DEFAULT_CACHE_TTL = 3600000

/**
 * Generate a simple hash key from thread content
 * Used for cache lookups
 */
function generateCacheKey(thread: DiscussionThread): string {
  const content = [
    thread.rootMessage.content,
    ...thread.replies.map(r => r.content),
  ].join('|')

  // Simple hash for cache key
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }

  return `thread_${thread.id}_${hash.toString(36)}`
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt
}

/**
 * Get cached analysis if available and valid
 */
function getCachedAnalysis(
  cacheKey: string,
): AIAnalysisResult | null {
  const cached = analysisCache.get(cacheKey)

  if (cached && isCacheValid(cached)) {
    return {
      ...cached.data,
      cached: true,
    }
  }

  // Remove expired entry
  if (cached) {
    analysisCache.delete(cacheKey)
  }

  return null
}

/**
 * Store analysis in cache
 */
function setCachedAnalysis(
  cacheKey: string,
  analysis: AIAnalysisResult,
  ttl = DEFAULT_CACHE_TTL,
): void {
  const now = Date.now()
  analysisCache.set(cacheKey, {
    data: analysis,
    timestamp: now,
    expiresAt: now + ttl,
  })
}

/**
 * Get the AI model for Claude via crouton-ai
 * Uses createAIProvider from @fyit/crouton-ai (auto-imported)
 *
 * @param modelId - The Claude model ID (defaults to claude-sonnet-4-5-20250929)
 * @returns Language model instance for use with generateText
 */
function getAIModel(modelId = 'claude-sonnet-4-5-20250929') {
  const ai = createAIProvider()
  return ai.model(modelId)
}

/**
 * Build the summary prompt with optional custom prompt and domain detection
 * Similar to Figno prototype's buildPrompt() function
 */
function buildSummaryPrompt(
  thread: DiscussionThread,
  sourceType?: string,
  customPrompt?: string,
  availableDomains?: string[],
): string {
  // Helper to get display name (authorName if available, fallback to authorHandle)
  const getDisplayName = (authorName?: string, authorHandle?: string) =>
    authorName || authorHandle || 'Unknown'

  // Build conversation history
  const messages = [
    `Root message by ${getDisplayName(thread.rootMessage.authorName, thread.rootMessage.authorHandle)}:`,
    thread.rootMessage.content,
    '',
    ...thread.replies.map(
      reply =>
        `Reply by ${getDisplayName(reply.authorName, reply.authorHandle)}:\n${reply.content}`,
    ),
  ].join('\n')

  const sourceContext = sourceType ? ` from ${sourceType}` : ''

  // Build page context if available (for Notion - shows what was commented on)
  let pageContext = ''
  if (thread.metadata?.pageContent) {
    pageContext = `\nPage Context (the content being discussed):\n${thread.metadata.pageContent}\n`
  }

  // Build domain detection instructions
  let domainInstructions = ''
  if (availableDomains && availableDomains.length > 0) {
    domainInstructions = `\n4. Detect the primary domain: Determine which domain this discussion primarily relates to. Available domains: ${availableDomains.join(', ')}. Return null if uncertain or if the discussion doesn't clearly fit one domain.`
  } else {
    domainInstructions = `\n4. Detect the primary domain: If the discussion clearly relates to a specific domain (e.g., design, frontend, backend, product, marketing, etc.), specify it. Return null if uncertain.`
  }

  let prompt = ''

  // If custom prompt is provided, use it with context
  if (customPrompt) {
    logger.debug('[AI Service] Using custom prompt template:', { customPrompt })

    // First, provide the custom instructions
    prompt = `${customPrompt}\n\n`

    // Add context about the source
    if (sourceContext) {
      prompt += `Context: This discussion is${sourceContext}.\n\n`
    }

    // Add page context if available (what the comment is about)
    if (pageContext) {
      prompt += `${pageContext}\n`
    }

    // Add the thread content
    prompt += `Discussion:\n${messages}\n\n`

    // Add domain detection instruction
    prompt += `\nImportant: ${domainInstructions}\n`

    // Request JSON format for parsing
    prompt += `\nPlease respond in JSON format:
{
  "summary": "...",
  "keyPoints": ["...", "...", "..."],
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0-1.0,
  "domain": "domain-name"|null
}`
  }
  else {
    // Default prompt structure
    prompt = `Analyze this discussion thread${sourceContext} and provide:

1. A concise summary (2-3 sentences)
2. Key points or decisions (ONLY if meaningful ones exist - return empty array if none)
3. Overall sentiment (positive, neutral, or negative)${domainInstructions}
${pageContext}
Discussion:
${messages}

Respond in JSON format:
{
  "summary": "...",
  "keyPoints": ["..."] or [],
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0-1.0,
  "domain": "domain-name"|null
}

IMPORTANT: Do NOT fabricate key points. If the discussion is brief or lacks meaningful decisions/insights, return an empty keyPoints array.`
  }

  return prompt
}

/**
 * Generate a summary of a discussion thread
 *
 * Model: claude-sonnet-4-5-20250929 (active until at least Sept 29, 2026)
 * See: https://docs.anthropic.com/en/docs/resources/model-deprecations
 */
async function generateSummary(
  thread: DiscussionThread,
  options: AIAnalysisOptions = {},
): Promise<AISummary> {
  const { sourceType, customSummaryPrompt, customPrompt, availableDomains } = options

  // Use customSummaryPrompt if available, fallback to customPrompt for backward compatibility
  const summaryPrompt = customSummaryPrompt || customPrompt

  // Build prompt with optional custom prompt and domain detection (similar to Figno prototype)
  const prompt = buildSummaryPrompt(thread, sourceType, summaryPrompt, availableDomains)

  logger.debug('[AI Service] Built summary prompt:', {
    hasCustomPrompt: !!summaryPrompt,
    customPromptLength: summaryPrompt?.length,
    promptLength: prompt.length,
  })

  const startTime = Date.now()

  const response = await retryWithBackoff(
    () =>
      generateText({
        model: getAIModel('claude-sonnet-4-5-20250929'),
        maxTokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      timeout: 30000, // 30 second timeout to prevent hanging
    },
  )

  const responseText = response.text
  if (!responseText) {
    throw new Error('No content in Claude response')
  }

  // Parse JSON response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Failed to parse JSON from Claude response')
  }

  const result = JSON.parse(jsonMatch[0])

  logger.debug('Generated summary', {
    duration: Date.now() - startTime,
    domain: result.domain || 'not detected'
  })

  return {
    summary: result.summary,
    keyPoints: result.keyPoints,
    sentiment: result.sentiment,
    confidence: result.confidence,
    domain: result.domain || null,
  }
}

/**
 * Detect actionable tasks from a discussion thread
 *
 * Model: claude-sonnet-4-5-20250929 (active until at least Sept 29, 2026)
 * See: https://docs.anthropic.com/en/docs/resources/model-deprecations
 */
async function detectTasks(
  thread: DiscussionThread,
  options: AIAnalysisOptions = {},
): Promise<TaskDetectionResult> {

  // Helper to get display name (authorName if available, fallback to authorHandle)
  const getDisplayName = (authorName?: string, authorHandle?: string) =>
    authorName || authorHandle || 'Unknown'

  // Build conversation history
  const messages = [
    `Root message by ${getDisplayName(thread.rootMessage.authorName, thread.rootMessage.authorHandle)}:`,
    thread.rootMessage.content,
    '',
    ...thread.replies.map(
      reply =>
        `Reply by ${getDisplayName(reply.authorName, reply.authorHandle)}:\n${reply.content}`,
    ),
  ].join('\n')

  const maxTasks = options.maxTasks || 5
  const { availableDomains } = options

  // Use customTaskPrompt if available, fallback to customPrompt for backward compatibility
  const taskPrompt = options.customTaskPrompt || options.customPrompt

  // Build domain detection instructions for tasks
  let domainInstructions = ''
  if (availableDomains && availableDomains.length > 0) {
    domainInstructions = `
### Domain Detection (CRITICAL)
For EACH task, determine which domain it belongs to based on the work involved.
Available domains: ${availableDomains.join(', ')}

- Analyze the task's technical requirements and assign the most appropriate domain
- Return null if the task doesn't clearly fit one domain or you're uncertain
- Better to return null than guess incorrectly

Examples:
- "Update button colors" → "design"
- "Fix API endpoint" → "backend"
- "Add React component" → "frontend"
- "Write product requirements" → "product"
- If uncertain or spans multiple domains → null
`
  } else {
    domainInstructions = `
### Domain Detection
For EACH task, determine which domain it belongs to if clearly identifiable (e.g., design, frontend, backend, product, etc.).
Return null if uncertain or if the task spans multiple domains.
`
  }

  // Build page context if available (for Notion - shows what was commented on)
  const pageContext = thread.metadata?.pageContent
    ? `<page_context>\n${thread.metadata.pageContent}\n</page_context>\n\n`
    : ''

  const prompt = `<task>
Analyze this discussion and identify actionable tasks. Extract task-specific action items for each task.
</task>

${pageContext}<discussion>
${messages}
</discussion>

${taskPrompt ? `<custom_instructions>\n${taskPrompt}\n</custom_instructions>` : ''}

<instructions>

## Task Detection Guidelines

1. **Identify Distinct Tasks**: Look for specific, actionable work items mentioned or implied
2. **Maximum Tasks**: Extract up to ${maxTasks} tasks
3. **Empty Array**: If no clear tasks exist, return empty array
4. **Multi-Task Detection**: Set isMultiTask=true if 2+ distinct tasks exist

${domainInstructions}

## Action Items Extraction (CRITICAL)

For each task, extract **task-specific action items** - concrete steps needed to complete ONLY this task.

<action_items_rules>
CRITICAL: Only extract action items that are EXPLICITLY mentioned in the discussion.
- Do NOT fabricate or infer action items that weren't stated
- Do NOT generate implementation steps based on the task title
- If no specific steps/subtasks are mentioned, return null
- Only include items the participants actually discussed doing

GOOD - Extracting what was actually said:
✅ Discussion: "We need to update the colors and test on mobile"
   → actionItems: ["Update the colors", "Test on mobile"]

BAD - Fabricating steps not mentioned:
❌ Discussion: "Convert codebase to JavaScript"
   → actionItems: ["Audit current codebase", "Set up tooling", "Convert files"] // WRONG - none of this was discussed
   → actionItems: null // CORRECT - no specific steps were mentioned
</action_items_rules>

<examples>
Example 1 - Single task:
Discussion: "The login button needs to be bigger and have better contrast for accessibility."
Result:
{
  "isMultiTask": false,
  "tasks": [{
    "title": "Improve login button accessibility",
    "description": "Increase size and contrast of login button to meet WCAG standards",
    "actionItems": [
      "Increase button size to minimum 44x44px touch target",
      "Update button colors to meet WCAG AA contrast ratio (4.5:1)",
      "Test with screen reader to verify button announcement"
    ],
    "priority": null,
    "type": null,
    "domain": "design"
  }]
}

Example 2 - Multiple related tasks:
Discussion: "We need to redesign the navigation. Build a collapsible side nav, add accessibility features, and test it on mobile."
Result:
{
  "isMultiTask": true,
  "tasks": [
    {
      "title": "Build collapsible side navigation component",
      "description": "Create a responsive side nav that collapses on mobile",
      "actionItems": [
        "Create nav component with collapsed (48px) and expanded (240px) states",
        "Add smooth 200ms transitions between states",
        "Implement localStorage to save user preference",
        "Add 6 primary navigation items with icons"
      ],
      "priority": null,
      "type": null,
      "domain": "frontend"
    },
    {
      "title": "Add accessibility features to navigation",
      "description": "Ensure navigation meets WCAG standards",
      "actionItems": [
        "Add aria-label attributes with full text for each nav item",
        "Implement aria-current for active navigation state",
        "Add 2px focus ring with high contrast colors",
        "Test tooltip accessibility with screen readers"
      ],
      "priority": null,
      "type": null,
      "domain": "frontend"
    },
    {
      "title": "Test navigation on mobile devices",
      "description": "Verify responsive behavior and usability across breakpoints",
      "actionItems": [
        "Test collapsed state on mobile (<768px)",
        "Verify transitions and animations are smooth",
        "Test touch interactions and gestures",
        "Validate localStorage persistence across sessions"
      ],
      "priority": null,
      "type": null,
      "domain": null
    }
  ]
}
</examples>

## Field Standardization

<field_rules>
### Confidence Rules (CRITICAL)
- ONLY fill priority, type, and assignee if EXPLICITLY stated in the conversation
- Do NOT infer or guess these fields from context — return null unless someone said it
- Better to return null than guess incorrectly
- This maintains data quality and prevents incorrect field mappings

### Priority
Use ONLY: "low" | "medium" | "high" | "urgent" | null
- Set ONLY when someone explicitly states priority (e.g., "this is urgent", "high priority", "not a priority")
- "urgent": Blocking issue, must be done immediately
- "high": Important work, should be done soon
- "medium": Normal priority work
- "low": Nice to have, can wait
- null: DEFAULT — use when priority is not explicitly mentioned

### Type
Use ONLY: "bug" | "feature" | "question" | "improvement" | null
- Set ONLY when the type is explicitly stated (e.g., "this is a bug", "feature request", "question about...")
- "bug": Something is broken and needs fixing
- "feature": New functionality or capability
- "question": Needs clarification or investigation
- "improvement": Enhancement to existing functionality
- null: DEFAULT — use when type is not explicitly mentioned

### Assignee
Extract the Notion user ID from mentions in format "@Name (notion-uuid)"
- Return ONLY the UUID part (e.g., from "@John Doe (abc-123-def)" return "abc-123-def")
- If multiple people mentioned, pick the most relevant person for the task
- If no clear assignee or no UUID available, return null

### Tags
Extract relevant technical or categorical tags if mentioned (e.g., ["navigation", "accessibility", "mobile"])
Return null if no clear tags

### Due Date
Extract only if explicitly mentioned (format: "YYYY-MM-DD")
Return null if not mentioned or unclear
</field_rules>

</instructions>

<response_format>
Respond with ONLY valid JSON in this exact format:
{
  "isMultiTask": true|false,
  "tasks": [
    {
      "title": "Concise task title (5-10 words)",
      "description": "Clear description of what needs to be done (1-2 sentences)",
      "actionItems": ["Step 1", "Step 2", "Step 3"] or null,
      "priority": "low"|"medium"|"high"|"urgent"|null,
      "type": "bug"|"feature"|"question"|"improvement"|null,
      "assignee": "uuid-string"|null,
      "dueDate": "YYYY-MM-DD"|null,
      "tags": ["tag1", "tag2"]|null,
      "domain": "domain-name"|null
    }
  ],
  "confidence": 0.0-1.0
}
</response_format>`

  const startTime = Date.now()

  const response = await retryWithBackoff(
    () =>
      generateText({
        model: getAIModel('claude-sonnet-4-5-20250929'),
        maxTokens: 2048,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      timeout: 30000, // 30 second timeout to prevent hanging
    },
  )

  const responseText = response.text
  if (!responseText) {
    throw new Error('No content in Claude response')
  }

  // Parse JSON response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Failed to parse JSON from Claude response')
  }

  const result = JSON.parse(jsonMatch[0])

  logger.debug('Detected tasks', { count: result.tasks.length, duration: Date.now() - startTime })

  // Log detailed task information for debugging user mappings
  logger.debug(`[AI Service] 🔍 Task Detection Debug - Full result:`)
  for (let i = 0; i < result.tasks.length; i++) {
    const task = result.tasks[i]
    logger.debug(`[AI Service] 🔍 Task ${i + 1}:`, {
      title: task.title,
      actionItems: task.actionItems?.length || 0,
      assignee: task.assignee,
      priority: task.priority,
      type: task.type,
      tags: task.tags,
      dueDate: task.dueDate,
    })

    if (task.assignee) {
      logger.debug(`[AI Service] ✅ AI extracted assignee: "${task.assignee}" (this will be looked up in user mappings)`)
    } else {
      logger.debug(`[AI Service] ⚠️  AI did not extract an assignee - returned null`)
      logger.debug(`[AI Service] 💡 Tip: Ensure discussion clearly mentions user with Slack ID (U...) or email`)
    }

    if (task.actionItems && task.actionItems.length > 0) {
      logger.debug(`[AI Service] ✅ AI extracted ${task.actionItems.length} action items for this task`)
    } else {
      logger.debug(`[AI Service] ⚠️  No action items extracted for this task`)
    }
  }

  return {
    isMultiTask: result.isMultiTask || result.tasks.length > 1,
    tasks: result.tasks,
    confidence: result.confidence,
  }
}

/**
 * Perform complete AI analysis of a discussion thread
 *
 * Combines summarization and task detection with intelligent caching.
 */
export async function analyzeDiscussion(
  thread: DiscussionThread,
  options: AIAnalysisOptions = {},
): Promise<AIAnalysisResult> {
  const startTime = Date.now()

  // Check cache first (unless skipCache is true)
  if (!options.skipCache) {
    const cacheKey = generateCacheKey(thread)
    const cached = getCachedAnalysis(cacheKey)

    if (cached) {
      logger.debug(`[AI Service] Cache hit for thread ${thread.id}`)
      return cached
    }

    logger.debug(`[AI Service] Cache miss for thread ${thread.id}`)
  }

  // Perform AI analysis
  logger.debug(`[AI Service] Analyzing thread ${thread.id}...`)

  const [summary, taskDetection] = await Promise.all([
    generateSummary(thread, options),
    detectTasks(thread, options),
  ])

  const processingTime = Date.now() - startTime

  const result: AIAnalysisResult = {
    summary,
    taskDetection,
    processingTime,
    cached: false,
  }

  // Cache the result
  if (!options.skipCache) {
    const cacheKey = generateCacheKey(thread)
    setCachedAnalysis(cacheKey, result)
    logger.debug('Cached analysis for thread', { threadId: thread.id })
  }

  logger.info('Completed analysis', { processingTime })

  return result
}

/**
 * Clear all cached analyses
 * Useful for testing or when cache needs to be invalidated
 */
export function clearAnalysisCache(): void {
  const size = analysisCache.size
  analysisCache.clear()
  logger.debug(`[AI Service] Cleared ${size} cached analyses`)
}

/**
 * Get cache statistics
 * Useful for monitoring and debugging
 */
export function getCacheStats() {
  const now = Date.now()
  let validEntries = 0
  let expiredEntries = 0

  for (const entry of analysisCache.values()) {
    if (isCacheValid(entry)) {
      validEntries++
    }
    else {
      expiredEntries++
    }
  }

  return {
    totalEntries: analysisCache.size,
    validEntries,
    expiredEntries,
    timestamp: now,
  }
}

/**
 * Clean up expired cache entries
 * Should be called periodically (e.g., every hour)
 */
export function cleanupExpiredCache(): void {
  const before = analysisCache.size

  for (const [key, entry] of analysisCache.entries()) {
    if (!isCacheValid(entry)) {
      analysisCache.delete(key)
    }
  }

  const removed = before - analysisCache.size

  if (removed > 0) {
    logger.debug('Cleaned up expired cache entries', { removed })
  }
}
