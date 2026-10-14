/**
 * Reply Generator Service - Personality-driven reply message generation
 *
 * This service generates reply messages for Crouton Triage with customizable personalities.
 * It supports:
 * - Preset personalities (professional, friendly, concise, pirate, robot, zen)
 * - Custom AI-generated personalities via prompts
 *
 * @example
 * ```typescript
 * // Using preset
 * const message = await generateReplyMessage(tasks, 'friendly', apiKey)
 *
 * // Using custom prompt
 * const message = await generateReplyMessage(tasks, 'custom:Reply as a friendly Australian', apiKey)
 * ```
 */

import type { NotionTaskResult } from '../../app/types'
import { logger } from '../utils/logger'

/**
 * Format a task as a link using source-appropriate syntax:
 * - Slack: `<url|title>` (mrkdwn clickable link)
 * - Others (Figma, email, Notion): `title — url` (plain text)
 *
 * Falls back to just the URL if title is missing.
 */
function formatTaskLink(t: NotionTaskResult, sourceType?: string): string {
  if (!t.title) return t.url
  if (sourceType === 'slack') return `<${t.url}|${t.title}>`
  return `${t.title} — ${t.url}`
}

/**
 * Preset personality definitions
 */
export const PERSONALITY_PRESETS = {
  professional: {
    label: 'Professional',
    description: 'Formal, clear, minimal',
    templates: {
      noTasks: '✅ Discussion processed (no tasks created)',
      singleTask: (task: NotionTaskResult, sourceType?: string) => `✅ Task created in Notion\n🔗 ${formatTaskLink(task, sourceType)}`,
      multipleTasks: (tasks: NotionTaskResult[], sourceType?: string) => {
        const taskList = tasks.map((t, i) => `${i + 1}. ${formatTaskLink(t, sourceType)}`).join('\n')
        return `✅ Created ${tasks.length} tasks in Notion:\n${taskList}`
      },
      bootstrap: (userCount: number) =>
        userCount > 0
          ? `Found ${userCount} user${userCount === 1 ? '' : 's'}. Map them in your dashboard.`
          : 'Bootstrap comment processed. No @mentions detected - add users manually in the dashboard.',
    },
  },
  friendly: {
    label: 'Friendly',
    description: 'Warm, encouraging',
    templates: {
      noTasks: 'Got it! 👍 I\'ve noted this discussion, but no specific tasks were needed.',
      singleTask: (task: NotionTaskResult, sourceType?: string) => `Nice catch! 🎯 I've logged this as a task for you:\n${formatTaskLink(task, sourceType)}`,
      multipleTasks: (tasks: NotionTaskResult[], sourceType?: string) => {
        const taskList = tasks.map((t, i) => `${i + 1}. ${formatTaskLink(t, sourceType)}`).join('\n')
        return `Great discussion! 🙌 I've created ${tasks.length} tasks:\n${taskList}`
      },
      bootstrap: (userCount: number) =>
        userCount > 0
          ? `Welcome aboard! 👋 Found ${userCount} team member${userCount === 1 ? '' : 's'}. Head to your dashboard to map them to Notion users.`
          : 'Hi there! 👋 Bootstrap received, but I didn\'t spot any @mentions. You can add users manually in the dashboard.',
    },
  },
  concise: {
    label: 'Concise',
    description: 'Ultra-brief',
    templates: {
      noTasks: '✓ Noted',
      singleTask: (task: NotionTaskResult, sourceType?: string) => `Done → ${formatTaskLink(task, sourceType)}`,
      multipleTasks: (tasks: NotionTaskResult[], sourceType?: string) =>
        `${tasks.length} tasks → ${tasks.map(t => formatTaskLink(t, sourceType)).join(' ')}`,
      bootstrap: (userCount: number) => userCount > 0 ? `${userCount} users found` : 'No users found',
    },
  },
  pirate: {
    label: 'Pirate',
    description: 'Arrr!',
    templates: {
      noTasks: 'Ahoy! ⚓ I\'ve scanned the horizon but found no treasure (tasks) to log!',
      singleTask: (task: NotionTaskResult, sourceType?: string) => `Arrr! ⚓ Task be logged in ye Notion seas!\n🗺️ ${formatTaskLink(task, sourceType)}`,
      multipleTasks: (tasks: NotionTaskResult[], sourceType?: string) => {
        const taskList = tasks.map((t, i) => `${i + 1}. ${formatTaskLink(t, sourceType)}`).join('\n')
        return `Shiver me timbers! ☠️ ${tasks.length} treasures have been charted:\n${taskList}`
      },
      bootstrap: (userCount: number) =>
        userCount > 0
          ? `Ahoy! 🏴‍☠️ ${userCount} crew member${userCount === 1 ? '' : 's'} spotted! Chart 'em in yer dashboard, captain!`
          : 'Arrr! No crew spotted in these waters. Add yer mateys manually!',
    },
  },
  robot: {
    label: 'Robot',
    description: 'Beep boop',
    templates: {
      noTasks: 'SCAN_COMPLETE. TASKS_DETECTED: 0. STATUS: ACKNOWLEDGED.',
      singleTask: (task: NotionTaskResult, sourceType?: string) => `TASK_CREATED: SUCCESS.\nDATA_LINK: ${formatTaskLink(task, sourceType)}\nSTATUS: OPERATIONAL.`,
      multipleTasks: (tasks: NotionTaskResult[], sourceType?: string) => {
        const taskList = tasks.map((t, i) => `[${i + 1}] ${formatTaskLink(t, sourceType)}`).join('\n')
        return `BATCH_PROCESS: COMPLETE.\nTASKS_GENERATED: ${tasks.length}\n${taskList}\nEND_TRANSMISSION.`
      },
      bootstrap: (userCount: number) =>
        userCount > 0
          ? `USER_SCAN: COMPLETE. ENTITIES_FOUND: ${userCount}. AWAITING_MAPPING_INPUT.`
          : 'USER_SCAN: COMPLETE. ENTITIES_FOUND: 0. MANUAL_INPUT_REQUIRED.',
    },
  },
  zen: {
    label: 'Zen',
    description: 'Calm, mindful',
    templates: {
      noTasks: '🧘 The discussion flows like water. No tasks arise from this moment.',
      singleTask: (task: NotionTaskResult, sourceType?: string) => `🧘 A task has found its home. Peace follows action.\n${formatTaskLink(task, sourceType)}`,
      multipleTasks: (tasks: NotionTaskResult[], sourceType?: string) => {
        const taskList = tasks.map((t, i) => `${i + 1}. ${formatTaskLink(t, sourceType)}`).join('\n')
        return `🧘 ${tasks.length} intentions have been set. Each step brings clarity.\n${taskList}`
      },
      bootstrap: (userCount: number) =>
        userCount > 0
          ? `🧘 ${userCount} soul${userCount === 1 ? '' : 's'} have been recognized. Connect them in your dashboard to complete the circle.`
          : '🧘 The search finds stillness. Add your companions when the time is right.',
    },
  },
} as const

export type PersonalityPreset = keyof typeof PERSONALITY_PRESETS

/**
 * Check if a personality string is a preset key
 */
export function isPreset(personality: string | null | undefined): personality is PersonalityPreset {
  return personality !== null && personality !== undefined && personality in PERSONALITY_PRESETS
}

/**
 * Check if a personality string is a custom prompt
 */
export function isCustomPrompt(personality: string | null | undefined): boolean {
  return personality !== null && personality !== undefined && personality.startsWith('custom:')
}

/**
 * Extract the custom prompt from a personality string
 */
export function extractCustomPrompt(personality: string): string {
  return personality.replace(/^custom:/, '').trim()
}

/**
 * Generate a confirmation message for task creation
 *
 * @param tasks - Created Notion tasks (can be empty array)
 * @param personality - Preset key or 'custom:...' prompt
 * @param anthropicApiKey - Required for custom prompts
 * @param personalityIcon - Optional emoji/icon to prefix the message
 * @param sourceType - Source platform (e.g. 'slack', 'figma') — controls link formatting
 * @returns Generated reply message
 */
export async function generateReplyMessage(
  tasks: NotionTaskResult[],
  personality: string | null | undefined,
  anthropicApiKey?: string,
  personalityIcon?: string,
  sourceType?: string,
): Promise<string> {
  // Default to professional if no personality specified
  const selectedPersonality = personality || 'professional'

  // Helper to prefix message with icon if provided
  const prefixIcon = (message: string): string => {
    if (personalityIcon && !message.startsWith(personalityIcon)) {
      return `${personalityIcon} ${message}`
    }
    return message
  }

  // Handle preset personalities
  if (isPreset(selectedPersonality)) {
    const preset = PERSONALITY_PRESETS[selectedPersonality]

    if (tasks.length === 0) {
      return prefixIcon(preset.templates.noTasks)
    }

    if (tasks.length === 1 && tasks[0]) {
      return prefixIcon(preset.templates.singleTask(tasks[0], sourceType))
    }

    return prefixIcon(preset.templates.multipleTasks(tasks, sourceType))
  }

  // Handle custom prompts
  if (isCustomPrompt(selectedPersonality)) {
    if (!anthropicApiKey) {
      logger.warn('Custom personality requires API key, falling back to professional')
      return generateReplyMessage(tasks, 'professional', undefined, personalityIcon, sourceType)
    }

    const customPrompt = extractCustomPrompt(selectedPersonality)
    const message = await generateCustomReply(tasks, customPrompt, anthropicApiKey)
    return prefixIcon(message)
  }

  // Unknown personality, fall back to professional
  logger.warn('Unknown personality, falling back to professional', { personality: selectedPersonality })
  return generateReplyMessage(tasks, 'professional', undefined, personalityIcon, sourceType)
}

/**
 * Generate a bootstrap message with personality
 *
 * @param userCount - Number of users discovered
 * @param personality - Preset key or 'custom:...' prompt
 * @param anthropicApiKey - Required for custom prompts
 * @param personalityIcon - Optional emoji/icon to prefix the message
 * @returns Generated bootstrap reply message
 */
export async function generateBootstrapMessage(
  userCount: number,
  personality: string | null | undefined,
  anthropicApiKey?: string,
  personalityIcon?: string,
): Promise<string> {
  const selectedPersonality = personality || 'professional'

  // Helper to prefix message with icon if provided
  const prefixIcon = (message: string): string => {
    if (personalityIcon && !message.startsWith(personalityIcon)) {
      return `${personalityIcon} ${message}`
    }
    return message
  }

  // Handle preset personalities
  if (isPreset(selectedPersonality)) {
    const preset = PERSONALITY_PRESETS[selectedPersonality]
    return prefixIcon(preset.templates.bootstrap(userCount))
  }

  // Handle custom prompts
  if (isCustomPrompt(selectedPersonality)) {
    if (!anthropicApiKey) {
      logger.warn('Custom personality requires API key, falling back to professional')
      return generateBootstrapMessage(userCount, 'professional', undefined, personalityIcon)
    }

    const customPrompt = extractCustomPrompt(selectedPersonality)
    const message = await generateCustomBootstrapReply(userCount, customPrompt, anthropicApiKey)
    return prefixIcon(message)
  }

  // Unknown personality, fall back to professional
  return generateBootstrapMessage(userCount, 'professional', undefined, personalityIcon)
}

/**
 * Generate a custom AI reply using Claude
 */
async function generateCustomReply(
  tasks: NotionTaskResult[],
  personalityPrompt: string,
  anthropicApiKey: string,
): Promise<string> {
  try {
    const taskContext = tasks.length === 0
      ? 'No tasks were created from this discussion.'
      : tasks.length === 1
        ? `One task was created: "${tasks[0]?.title}" (${tasks[0]?.url})`
        : `${tasks.length} tasks were created:\n${tasks.map((t, i) => `${i + 1}. "${t.title}" (${t.url})`).join('\n')}`

    const response = await $fetch<{ content: Array<{ text: string }> }>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: 'claude-3-haiku-20240307',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: `You are a bot confirming task creation. ${personalityPrompt}

Context: ${taskContext}

Generate a SHORT reply message (1-3 sentences max) confirming the task(s). Include the URLs if tasks were created. Keep it brief and match the personality style.`,
          },
        ],
      },
    })

    const text = response?.content?.[0]?.text
    if (text) {
      return text.trim()
    }

    throw new Error('No response text from AI')
  } catch (error) {
    logger.error('Custom reply generation failed, falling back to professional', { error })
    return generateReplyMessage(tasks, 'professional')
  }
}

/**
 * Generate a custom AI bootstrap reply using Claude
 */
async function generateCustomBootstrapReply(
  userCount: number,
  personalityPrompt: string,
  anthropicApiKey: string,
): Promise<string> {
  try {
    const context = userCount > 0
      ? `${userCount} user${userCount === 1 ? ' was' : 's were'} discovered from @mentions.`
      : 'No users were found in the @mentions.'

    const response = await $fetch<{ content: Array<{ text: string }> }>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `You are a bot confirming user discovery for mapping. ${personalityPrompt}

Context: ${context} ${userCount > 0 ? 'Users need to be mapped in the dashboard.' : 'Users can be added manually in the dashboard.'}

Generate a SHORT reply message (1-2 sentences max) about the user discovery. Keep it brief and match the personality style.`,
          },
        ],
      },
    })

    const text = response?.content?.[0]?.text
    if (text) {
      return text.trim()
    }

    throw new Error('No response text from AI')
  } catch (error) {
    logger.error('Custom bootstrap reply generation failed, falling back to professional', { error })
    return generateBootstrapMessage(userCount, 'professional')
  }
}
