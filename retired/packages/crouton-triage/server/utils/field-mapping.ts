/**
 * Server-side field mapping utilities
 *
 * Extends shared field-mapping with server-specific logic:
 * - generateDefaultMapping: broader set of AI fields + multi_select support
 * - transformValue: runtime value transformation for Notion API writes
 */

import {
  calculateSimilarity,
  findBestMatch,
  generateValueMapping,
} from '../../shared/utils/field-mapping'

/**
 * Generate default field mappings from Notion schema
 *
 * Server version maps a broader set of AI fields than the client composable
 * and also handles multi_select property types.
 */
export function generateDefaultMapping(notionSchema: {
  properties: Record<string, any>
}): Record<string, any> {
  const mapping: Record<string, any> = {}

  // AI fields that can be mapped (from DetectedTask interface)
  const aiFields = ['priority', 'type', 'assignee', 'dueDate', 'tags', 'domain']

  for (const aiField of aiFields) {
    const match = findBestMatch(aiField, notionSchema.properties)

    if (match) {
      mapping[aiField] = {
        notionProperty: match.propertyName,
        propertyType: match.propertyType,
        valueMap: {}
      }

      // Generate value mapping for select/multi_select/status fields
      if (
        match.propertyType === 'select' ||
        match.propertyType === 'multi_select' ||
        match.propertyType === 'status'
      ) {
        const propInfo = notionSchema.properties[match.propertyName]
        if (propInfo.options) {
          mapping[aiField].valueMap = generateValueMapping(aiField, propInfo.options)
        }
      }
    }
  }

  return mapping
}

/**
 * Transform AI value to Notion-compatible value
 *
 * Performs case-insensitive fuzzy matching to transform AI values
 * into Notion property values.
 */
export function transformValue(
  aiValue: string | null | undefined,
  selectOptions?: Array<{ name: string }>,
  valueMap?: Record<string, string>
): string | null {
  if (!aiValue) {
    return null
  }

  // Check explicit value map first
  if (valueMap) {
    const mapped = valueMap[aiValue.toLowerCase()]
    if (mapped) {
      return mapped
    }
  }

  // If no select options, return original value
  if (!selectOptions || selectOptions.length === 0) {
    return aiValue
  }

  // Fuzzy match against available options
  let bestMatch: { name: string; score: number } | null = null

  for (const option of selectOptions) {
    const score = calculateSimilarity(aiValue, option.name)

    if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { name: option.name, score }
    }
  }

  return bestMatch ? bestMatch.name : aiValue
}
