/**
 * Shared field-mapping utilities
 *
 * Used by both client (useTriageFieldMapping composable) and server (field-mapping utils)
 * for fuzzy-matching AI field names to Notion properties.
 */

export interface FieldMapping {
  notionProperty: string
  propertyType: string
  valueMap: Record<string, string>
}

export interface NotionSchemaForMapping {
  properties: Record<string, {
    type: string
    options?: Array<{ name: string }>
  }>
}

/**
 * Simple string similarity score (0-1)
 *
 * - Exact match: 1.0
 * - Substring match: 0.8
 * - Prefix match: proportional to matching length
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()

  if (s1 === s2) return 1.0
  if (s1.includes(s2) || s2.includes(s1)) return 0.8

  const minLength = Math.min(s1.length, s2.length)
  let matchingChars = 0
  for (let i = 0; i < minLength; i++) {
    if (s1[i] === s2[i]) matchingChars++
    else break
  }

  return matchingChars / Math.max(s1.length, s2.length)
}

/**
 * Find best matching Notion property for an AI field
 */
export function findBestMatch(
  aiField: string,
  properties: Record<string, any>,
  threshold = 0.5
): { propertyName: string; propertyType: string; score: number } | null {
  let bestMatch: { propertyName: string; propertyType: string; score: number } | null = null

  for (const [propName, propInfo] of Object.entries(properties)) {
    const score = calculateSimilarity(aiField, propName)

    if (score > threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        propertyName: propName,
        propertyType: propInfo.type,
        score
      }
    }
  }

  return bestMatch
}

/**
 * Synonyms for common priority and type naming conventions.
 * Used as a fallback when fuzzy name matching fails (e.g. AI says "urgent"
 * but Notion uses "P1" — no name similarity, but they mean the same thing).
 */
const VALUE_SYNONYMS: Record<string, Record<string, string[]>> = {
  priority: {
    urgent: ['p1', 'p0', 'critical', 'blocker', 'highest'],
    high: ['p2', 'important'],
    medium: ['p3', 'normal', 'standard', 'default'],
    low: ['p4', 'p5', 'minor', 'lowest', 'nice to have'],
  },
  type: {
    bug: ['defect', 'issue', 'error', 'fix'],
    feature: ['story', 'enhancement', 'new', 'epic'],
    question: ['q&a', 'inquiry', 'discussion'],
    improvement: ['refactor', 'chore', 'optimization', 'enhancement'],
  },
}

/**
 * Generate value mapping for select fields
 *
 * Maps AI values (low/medium/high or bug/feature/etc) to Notion options using:
 * 1. Exact/fuzzy name match (e.g. "high" → "High")
 * 2. Synonym fallback (e.g. "urgent" → "P1", "medium" → "P3")
 */
export function generateValueMapping(
  aiFieldType: string,
  notionOptions?: Array<{ name: string }>,
  threshold = 0.3
): Record<string, string> {
  if (!notionOptions || notionOptions.length === 0) return {}

  const valueMap: Record<string, string> = {}
  const aiValues = aiFieldType === 'priority'
    ? ['low', 'medium', 'high', 'urgent']
    : ['bug', 'feature', 'question', 'improvement']

  const synonymsForField = VALUE_SYNONYMS[aiFieldType] || {}

  for (const aiValue of aiValues) {
    let bestMatch: { name: string; score: number } | null = null

    // Try fuzzy name match first (e.g. "high" matches "High" or "Highish")
    for (const option of notionOptions) {
      const score = calculateSimilarity(aiValue, option.name)
      if (score > threshold && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { name: option.name, score }
      }
    }

    // Fallback to synonyms (e.g. "urgent" matches "P1" via synonym list)
    if (!bestMatch) {
      const synonyms = synonymsForField[aiValue] || []
      for (const option of notionOptions) {
        const optionLower = option.name.toLowerCase().trim()
        if (synonyms.some(syn => syn === optionLower)) {
          bestMatch = { name: option.name, score: 1 }
          break
        }
      }
    }

    if (bestMatch) {
      valueMap[aiValue] = bestMatch.name
    }
  }

  return valueMap
}
