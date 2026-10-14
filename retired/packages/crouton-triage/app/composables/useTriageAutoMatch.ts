/**
 * Composable for auto-matching users between source platforms and Notion
 *
 * Provides email-based matching between Slack/Figma users and Notion users.
 * Used in the user mapping discovery UI to suggest automatic mappings.
 *
 * @example
 * ```ts
 * const { autoMatchByEmail, matches, unmatched } = useTriageAutoMatch()
 *
 * // Auto-match Slack users to Notion users
 * autoMatchByEmail(slackUsers, notionUsers)
 *
 * // View results
 * console.log('Matched:', matches.value.length)
 * console.log('Unmatched:', unmatched.value.length)
 * ```
 */

import type { SlackUser } from './useTriageSlackUsers'
import type { NotionUser } from './useTriageNotionUsers'

export interface UserMatch {
  sourceUser: SourceUser
  notionUser: NotionUser
  confidence: number  // 0-1, 1.0 = exact email match
  matchType: 'email' | 'name' | 'manual'
}

export interface SourceUser {
  id: string
  name: string
  email: string | null
  avatar?: string | null
  realName?: string | null
}

export function useTriageAutoMatch() {
  const matches = ref<UserMatch[]>([])
  const unmatched = ref<SourceUser[]>([])

  /**
   * Auto-match users by email address
   * Returns matches and unmatched source users
   */
  function autoMatchByEmail(
    sourceUsers: SourceUser[],
    notionUsers: NotionUser[]
  ): { matched: UserMatch[], unmatched: SourceUser[] } {
    const newMatches: UserMatch[] = []
    const newUnmatched: SourceUser[] = []

    // Create email lookup map for Notion users
    const notionByEmail = new Map<string, NotionUser>()
    for (const user of notionUsers) {
      if (user.email) {
        notionByEmail.set(user.email.toLowerCase(), user)
      }
    }

    // Match each source user
    for (const sourceUser of sourceUsers) {
      if (sourceUser.email) {
        const notionUser = notionByEmail.get(sourceUser.email.toLowerCase())
        if (notionUser) {
          newMatches.push({
            sourceUser,
            notionUser,
            confidence: 1.0,
            matchType: 'email'
          })
          continue
        }
      }

      // No match found
      newUnmatched.push(sourceUser)
    }

    matches.value = newMatches
    unmatched.value = newUnmatched

    return {
      matched: newMatches,
      unmatched: newUnmatched
    }
  }

  /**
   * Try to match by similar name (fuzzy matching)
   * Lower confidence than email matching
   */
  function suggestByName(
    sourceUser: SourceUser,
    notionUsers: NotionUser[]
  ): NotionUser | null {
    const sourceName = (sourceUser.realName || sourceUser.name).toLowerCase()

    // Find best name match
    let bestMatch: NotionUser | null = null
    let bestScore = 0

    for (const notionUser of notionUsers) {
      const notionName = notionUser.name.toLowerCase()

      // Simple similarity: check if names contain each other
      const score = calculateNameSimilarity(sourceName, notionName)

      if (score > bestScore && score >= 0.5) {
        bestScore = score
        bestMatch = notionUser
      }
    }

    return bestMatch
  }

  /**
   * Calculate simple name similarity score (0-1)
   */
  function calculateNameSimilarity(name1: string, name2: string): number {
    // Normalize names
    const n1 = name1.toLowerCase().trim()
    const n2 = name2.toLowerCase().trim()

    // Exact match
    if (n1 === n2) return 1.0

    // Check if one contains the other
    if (n1.includes(n2) || n2.includes(n1)) return 0.8

    // Check first name match
    const parts1 = n1.split(/\s+/)
    const parts2 = n2.split(/\s+/)

    if (parts1[0] === parts2[0]) return 0.6

    // Check last name match
    if (parts1.length > 1 && parts2.length > 1) {
      if (parts1[parts1.length - 1] === parts2[parts2.length - 1]) {
        return 0.5
      }
    }

    return 0
  }

  /**
   * Manually add a match
   */
  function addManualMatch(sourceUser: SourceUser, notionUser: NotionUser) {
    // Remove from unmatched if present
    const index = unmatched.value.findIndex(u => u.id === sourceUser.id)
    if (index !== -1) {
      unmatched.value.splice(index, 1)
    }

    // Check if already matched
    const existingIndex = matches.value.findIndex(m => m.sourceUser.id === sourceUser.id)
    if (existingIndex !== -1) {
      matches.value[existingIndex] = {
        sourceUser,
        notionUser,
        confidence: 1.0,
        matchType: 'manual'
      }
    } else {
      matches.value.push({
        sourceUser,
        notionUser,
        confidence: 1.0,
        matchType: 'manual'
      })
    }
  }

  /**
   * Remove a match
   */
  function removeMatch(sourceUserId: string) {
    const index = matches.value.findIndex(m => m.sourceUser.id === sourceUserId)
    if (index !== -1) {
      const match = matches.value[index]
      if (match) {
        matches.value.splice(index, 1)
        unmatched.value.push(match.sourceUser)
      }
    }
  }

  /**
   * Clear all matches
   */
  function clearMatches() {
    matches.value = []
    unmatched.value = []
  }

  return {
    autoMatchByEmail,
    suggestByName,
    calculateNameSimilarity,
    addManualMatch,
    removeMatch,
    clearMatches,
    matches,
    unmatched,
  }
}
