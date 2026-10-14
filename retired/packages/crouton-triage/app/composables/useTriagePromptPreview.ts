/**
 * Composable for building prompt previews
 *
 * Replicates server-side prompt building logic for client-side preview
 */

export interface PromptPreview {
  summaryPrompt: string
  taskPrompt: string
  summaryCharCount: number
  taskCharCount: number
  summaryTokenEstimate: number
  taskTokenEstimate: number
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Build sample discussion for preview
 */
function getSampleDiscussion(): string {
  return `Root message by @designer:
I think we should update the button styles to match the new design system. The current buttons feel too flat.

Reply by @developer:
Agreed! Should we update all buttons or just the primary ones?

Reply by @designer:
Let's start with primary buttons and see how they look. We can iterate from there.`
}

/**
 * Build summary prompt (client-side version of buildSummaryPrompt)
 */
function buildSummaryPrompt(customPrompt?: string): string {
  const messages = getSampleDiscussion()
  const sourceType = 'Figma' // Example source type
  const sourceContext = sourceType ? ` from ${sourceType}` : ''

  let prompt = ''

  // If custom prompt is provided, use it with context
  if (customPrompt && customPrompt.trim()) {
    // First, provide the custom instructions
    prompt = `${customPrompt}\n\n`

    // Add context about the source
    if (sourceContext) {
      prompt += `Context: This discussion is${sourceContext}.\n\n`
    }

    // Add the thread content
    prompt += `Discussion:\n${messages}\n\n`

    // Request JSON format for parsing
    prompt += `Please respond in JSON format:
{
  "summary": "...",
  "keyPoints": ["...", "...", "..."],
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0-1.0
}`
  }
  else {
    // Default prompt structure
    prompt = `Analyze this discussion thread${sourceContext} and provide:

1. A concise summary (2-3 sentences)
2. Key points or decisions (ONLY if meaningful ones exist - return empty array if none)
3. Overall sentiment (positive, neutral, or negative)

Discussion:
${messages}

Respond in JSON format:
{
  "summary": "...",
  "keyPoints": ["..."] or [],
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0-1.0
}

IMPORTANT: Do NOT fabricate key points. If the discussion is brief or lacks meaningful decisions/insights, return an empty keyPoints array.`
  }

  return prompt
}

/**
 * Build task detection prompt (client-side version of detectTasks)
 */
function buildTaskPrompt(customPrompt?: string): string {
  const messages = getSampleDiscussion()
  const maxTasks = 5

  const prompt = `Analyze this discussion and identify actionable tasks.

Discussion:
${messages}

${customPrompt || ''}

Instructions:
- Identify specific, actionable tasks mentioned or implied
- Extract title, description, and priority for each task
- Determine if there are multiple distinct tasks (isMultiTask: true/false)
- Maximum ${maxTasks} tasks
- If no clear tasks, return empty array

Respond in JSON format:
{
  "isMultiTask": true|false,
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "priority": "low|medium|high|urgent",
      "assignee": "...",
      "tags": ["..."]
    }
  ],
  "confidence": 0.0-1.0
}`

  return prompt
}

/**
 * Main composable for prompt preview
 */
export function useTriagePromptPreview() {
  const buildPreview = (
    customSummaryPrompt?: string,
    customTaskPrompt?: string
  ): PromptPreview => {
    const summaryPrompt = buildSummaryPrompt(customSummaryPrompt)
    const taskPrompt = buildTaskPrompt(customTaskPrompt)

    return {
      summaryPrompt,
      taskPrompt,
      summaryCharCount: summaryPrompt.length,
      taskCharCount: taskPrompt.length,
      summaryTokenEstimate: estimateTokens(summaryPrompt),
      taskTokenEstimate: estimateTokens(taskPrompt),
    }
  }

  return {
    buildPreview,
  }
}
