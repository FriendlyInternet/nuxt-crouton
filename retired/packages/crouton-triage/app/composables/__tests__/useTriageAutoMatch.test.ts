import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

// Mock Vue auto-imports (ref is used implicitly in the composable)
vi.stubGlobal('ref', ref)

import { useTriageAutoMatch, type SourceUser } from '../useTriageAutoMatch'
import type { NotionUser } from '../useTriageNotionUsers'

// ============================================================================
// Helpers
// ============================================================================
function makeSourceUser(overrides: Partial<SourceUser> = {}): SourceUser {
  return {
    id: 'src-1',
    name: 'John Doe',
    email: 'john@example.com',
    ...overrides,
  }
}

function makeNotionUser(overrides: Partial<NotionUser> = {}): NotionUser {
  return {
    id: 'notion-1',
    name: 'John Doe',
    email: 'john@example.com',
    type: 'person' as const,
    avatarUrl: null,
    ...overrides,
  }
}

// ============================================================================
// autoMatchByEmail
// ============================================================================
describe('autoMatchByEmail', () => {
  it('matches users with identical emails', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const source = [makeSourceUser({ email: 'john@example.com' })]
    const notion = [makeNotionUser({ email: 'john@example.com' })]

    const result = autoMatchByEmail(source, notion)
    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
    expect(result.matched[0]!.confidence).toBe(1.0)
    expect(result.matched[0]!.matchType).toBe('email')
  })

  it('matches emails case-insensitively', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const source = [makeSourceUser({ email: 'John@Example.COM' })]
    const notion = [makeNotionUser({ email: 'john@example.com' })]

    const result = autoMatchByEmail(source, notion)
    expect(result.matched).toHaveLength(1)
  })

  it('puts users without email match in unmatched', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const source = [makeSourceUser({ email: 'nomatch@example.com' })]
    const notion = [makeNotionUser({ email: 'different@example.com' })]

    const result = autoMatchByEmail(source, notion)
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  it('handles source users with null email', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const source = [makeSourceUser({ email: null })]
    const notion = [makeNotionUser({ email: 'john@example.com' })]

    const result = autoMatchByEmail(source, notion)
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  it('handles Notion users with null email', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const source = [makeSourceUser({ email: 'john@example.com' })]
    const notion = [makeNotionUser({ email: undefined as any })]

    const result = autoMatchByEmail(source, notion)
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  it('matches multiple users correctly', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const source = [
      makeSourceUser({ id: 'src-1', email: 'alice@example.com' }),
      makeSourceUser({ id: 'src-2', email: 'bob@example.com' }),
      makeSourceUser({ id: 'src-3', email: 'charlie@example.com' }),
    ]
    const notion = [
      makeNotionUser({ id: 'n-1', email: 'alice@example.com' }),
      makeNotionUser({ id: 'n-2', email: 'bob@example.com' }),
    ]

    const result = autoMatchByEmail(source, notion)
    expect(result.matched).toHaveLength(2)
    expect(result.unmatched).toHaveLength(1)
    expect(result.unmatched[0]!.id).toBe('src-3')
  })

  it('updates reactive state', () => {
    const { autoMatchByEmail, matches, unmatched } = useTriageAutoMatch()

    const source = [
      makeSourceUser({ id: 'src-1', email: 'alice@example.com' }),
      makeSourceUser({ id: 'src-2', email: 'nomatch@example.com' }),
    ]
    const notion = [makeNotionUser({ id: 'n-1', email: 'alice@example.com' })]

    autoMatchByEmail(source, notion)
    expect(matches.value).toHaveLength(1)
    expect(unmatched.value).toHaveLength(1)
  })

  it('handles empty source users', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const result = autoMatchByEmail([], [makeNotionUser()])
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(0)
  })

  it('handles empty Notion users', () => {
    const { autoMatchByEmail } = useTriageAutoMatch()

    const result = autoMatchByEmail([makeSourceUser()], [])
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })
})

// ============================================================================
// calculateNameSimilarity
// ============================================================================
describe('calculateNameSimilarity', () => {
  it('returns 1.0 for exact match', () => {
    const { calculateNameSimilarity } = useTriageAutoMatch()
    expect(calculateNameSimilarity('John Doe', 'john doe')).toBe(1.0)
  })

  it('returns 0.8 when one name contains the other', () => {
    const { calculateNameSimilarity } = useTriageAutoMatch()
    expect(calculateNameSimilarity('John', 'John Doe')).toBe(0.8)
  })

  it('returns 0.6 for first name match', () => {
    const { calculateNameSimilarity } = useTriageAutoMatch()
    expect(calculateNameSimilarity('John Smith', 'John Williams')).toBe(0.6)
  })

  it('returns 0.5 for last name match', () => {
    const { calculateNameSimilarity } = useTriageAutoMatch()
    expect(calculateNameSimilarity('Alice Smith', 'Bob Smith')).toBe(0.5)
  })

  it('returns 0 for completely different names', () => {
    const { calculateNameSimilarity } = useTriageAutoMatch()
    expect(calculateNameSimilarity('Alice Johnson', 'Bob Williams')).toBe(0)
  })

  it('handles extra whitespace', () => {
    const { calculateNameSimilarity } = useTriageAutoMatch()
    expect(calculateNameSimilarity('  John Doe  ', 'john doe')).toBe(1.0)
  })
})

// ============================================================================
// suggestByName
// ============================================================================
describe('suggestByName', () => {
  it('suggests user with matching name', () => {
    const { suggestByName } = useTriageAutoMatch()

    const sourceUser = makeSourceUser({ name: 'John Doe', realName: 'John Doe' })
    const notionUsers = [
      makeNotionUser({ id: 'n-1', name: 'John Doe' }),
      makeNotionUser({ id: 'n-2', name: 'Alice Smith' }),
    ]

    const result = suggestByName(sourceUser, notionUsers)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('n-1')
  })

  it('uses realName over name for matching', () => {
    const { suggestByName } = useTriageAutoMatch()

    const sourceUser = makeSourceUser({ name: 'jdoe', realName: 'John Doe' })
    const notionUsers = [makeNotionUser({ id: 'n-1', name: 'John Doe' })]

    const result = suggestByName(sourceUser, notionUsers)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('n-1')
  })

  it('falls back to name when realName is null', () => {
    const { suggestByName } = useTriageAutoMatch()

    const sourceUser = makeSourceUser({ name: 'John Doe', realName: null })
    const notionUsers = [makeNotionUser({ id: 'n-1', name: 'John Doe' })]

    const result = suggestByName(sourceUser, notionUsers)
    expect(result).not.toBeNull()
  })

  it('returns null when no match above threshold', () => {
    const { suggestByName } = useTriageAutoMatch()

    const sourceUser = makeSourceUser({ name: 'Completely Different', realName: null })
    const notionUsers = [makeNotionUser({ name: 'No Match Here' })]

    expect(suggestByName(sourceUser, notionUsers)).toBeNull()
  })

  it('returns null for empty Notion users', () => {
    const { suggestByName } = useTriageAutoMatch()

    const sourceUser = makeSourceUser()
    expect(suggestByName(sourceUser, [])).toBeNull()
  })
})

// ============================================================================
// addManualMatch / removeMatch / clearMatches
// ============================================================================
describe('manual match management', () => {
  it('adds a manual match', () => {
    const { addManualMatch, matches } = useTriageAutoMatch()

    const source = makeSourceUser({ id: 'src-1' })
    const notion = makeNotionUser({ id: 'n-1' })

    addManualMatch(source, notion)
    expect(matches.value).toHaveLength(1)
    expect(matches.value[0]!.matchType).toBe('manual')
    expect(matches.value[0]!.confidence).toBe(1.0)
  })

  it('removes user from unmatched when manually matched', () => {
    const { autoMatchByEmail, addManualMatch, unmatched } = useTriageAutoMatch()

    const source = [makeSourceUser({ id: 'src-1', email: 'nomatch@example.com' })]
    autoMatchByEmail(source, [])
    expect(unmatched.value).toHaveLength(1)

    addManualMatch(source[0]!, makeNotionUser({ id: 'n-1' }))
    expect(unmatched.value).toHaveLength(0)
  })

  it('replaces existing match when manually matched again', () => {
    const { addManualMatch, matches } = useTriageAutoMatch()

    const source = makeSourceUser({ id: 'src-1' })
    const notion1 = makeNotionUser({ id: 'n-1' })
    const notion2 = makeNotionUser({ id: 'n-2' })

    addManualMatch(source, notion1)
    addManualMatch(source, notion2)

    expect(matches.value).toHaveLength(1)
    expect(matches.value[0]!.notionUser.id).toBe('n-2')
  })

  it('removes a match and moves user back to unmatched', () => {
    const { addManualMatch, removeMatch, matches, unmatched } = useTriageAutoMatch()

    const source = makeSourceUser({ id: 'src-1' })
    addManualMatch(source, makeNotionUser({ id: 'n-1' }))
    expect(matches.value).toHaveLength(1)

    removeMatch('src-1')
    expect(matches.value).toHaveLength(0)
    expect(unmatched.value).toHaveLength(1)
    expect(unmatched.value[0]!.id).toBe('src-1')
  })

  it('does nothing when removing non-existent match', () => {
    const { removeMatch, matches, unmatched } = useTriageAutoMatch()

    removeMatch('nonexistent')
    expect(matches.value).toHaveLength(0)
    expect(unmatched.value).toHaveLength(0)
  })

  it('clears all matches', () => {
    const { autoMatchByEmail, clearMatches, matches, unmatched } = useTriageAutoMatch()

    autoMatchByEmail(
      [makeSourceUser({ email: 'a@b.com' }), makeSourceUser({ id: 'src-2', email: 'no@match.com' })],
      [makeNotionUser({ email: 'a@b.com' })],
    )
    expect(matches.value).toHaveLength(1)
    expect(unmatched.value).toHaveLength(1)

    clearMatches()
    expect(matches.value).toHaveLength(0)
    expect(unmatched.value).toHaveLength(0)
  })
})
