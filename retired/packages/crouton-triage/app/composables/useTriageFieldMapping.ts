/**
 * Field mapping utilities for fuzzy matching
 *
 * Provides utilities for auto-generating field mappings between AI fields
 * and Notion properties using similarity scoring.
 *
 * @example
 * ```ts
 * const mapping = generateAutoMapping(notionSchema, {
 *   aiFields: ['priority', 'type', 'assignee']
 * })
 * ```
 */

import {
  calculateSimilarity,
  findBestMatch,
  generateValueMapping,
  type FieldMapping,
  type NotionSchemaForMapping,
} from '../../shared/utils/field-mapping'

export { calculateSimilarity, findBestMatch, generateValueMapping }
export type { FieldMapping, NotionSchemaForMapping }

export interface GenerateMappingOptions {
  /**
   * AI fields to map
   * @default ['priority', 'type', 'assignee']
   */
  aiFields?: string[]

  /**
   * Minimum similarity threshold for matching (0-1)
   * @default 0.5
   */
  similarityThreshold?: number
}

/**
 * Generate complete auto-mapping from Notion schema
 */
export function generateAutoMapping(
  schema: NotionSchemaForMapping,
  options: GenerateMappingOptions = {}
): Record<string, FieldMapping> {
  const {
    aiFields = ['priority', 'type', 'assignee'],
    similarityThreshold = 0.5
  } = options

  const mapping: Record<string, FieldMapping> = {}

  for (const aiField of aiFields) {
    const match = findBestMatch(aiField, schema.properties, similarityThreshold)

    if (match) {
      mapping[aiField] = {
        notionProperty: match.propertyName,
        propertyType: match.propertyType,
        valueMap: {}
      }

      // Generate value mapping for select/status fields
      if (match.propertyType === 'select' || match.propertyType === 'status') {
        const propInfo = schema.properties[match.propertyName]
        if (propInfo!.options) {
          mapping[aiField].valueMap = generateValueMapping(aiField, propInfo!.options)
        }
      }
    }
  }

  return mapping
}

/**
 * Get property type badge color for UI
 */
export function getPropertyTypeColor(type: string): string {
  const colorMap: Record<string, string> = {
    'select': 'blue',
    'multi_select': 'purple',
    'status': 'green',
    'people': 'orange',
    'date': 'pink',
    'rich_text': 'gray',
    'title': 'gray'
  }

  return colorMap[type] || 'gray'
}

/**
 * Alias for generateAutoMapping (backward compat)
 */
export const autoMapFields = generateAutoMapping
