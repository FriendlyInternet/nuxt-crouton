/**
 * Adapter Registry
 *
 * Central registry for all discussion source adapters.
 * Provides a factory pattern to retrieve adapters by source type.
 */

import type { DiscussionSourceAdapter, AdapterRegistry } from './base'
import { createFigmaAdapter } from './figma'
import { createSlackAdapter } from './slack'
import { createNotionAdapter } from './notion'

/**
 * Registry of all available adapters
 */
const adapters: AdapterRegistry = {
  figma: createFigmaAdapter(),
  slack: createSlackAdapter(),
  notion: createNotionAdapter(),
  // Future adapters:
  // linear: createLinearAdapter(),
}

/**
 * Get an adapter instance by source type
 *
 * @param sourceType - The source type (e.g., 'figma', 'slack')
 * @returns The adapter instance
 * @throws Error if source type is not supported
 *
 * @example
 * ```typescript
 * const adapter = getAdapter('figma')
 * const parsed = await adapter.parseIncoming(mailgunPayload)
 * ```
 */
export function getAdapter(sourceType: string): DiscussionSourceAdapter {
  const adapter = adapters[sourceType]
  if (!adapter) {
    throw new Error(
      `Unsupported source type: ${sourceType}. Available types: ${Object.keys(adapters).join(', ')}`
    )
  }
  return adapter
}

/**
 * Check if a source type is supported
 *
 * @param sourceType - The source type to check
 * @returns true if the source type has an adapter
 *
 * @example
 * ```typescript
 * if (isSourceTypeSupported('figma')) {
 *   // Process Figma discussion
 * }
 * ```
 */
export function isSourceTypeSupported(sourceType: string): boolean {
  return sourceType in adapters
}

/**
 * Get list of all supported source types
 *
 * @returns Array of supported source type names
 *
 * @example
 * ```typescript
 * const types = getSupportedSourceTypes()
 * // ['figma', 'slack', 'linear']
 * ```
 */
export function getSupportedSourceTypes(): string[] {
  return Object.keys(adapters)
}

// Re-export adapter types and base classes
export type { DiscussionSourceAdapter, AdapterRegistry }
export { AdapterError } from './base'
export { FigmaAdapter, createFigmaAdapter } from './figma'
export { SlackAdapter, createSlackAdapter } from './slack'
export { NotionAdapter, createNotionAdapter } from './notion'
