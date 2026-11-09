import { describe, it, expect } from 'vitest'
import { resolveTeamEntryRoute, resolveCreateTeamGuard } from '../../shared/utils/auth'

describe('team entry routing (#3130)', () => {
  it('site admin with no team goes to create-team', () => {
    expect(resolveTeamEntryRoute({ canCreateTeam: true })).toBe('/onboarding/create-team')
  })
  it('team member lands in their team admin', () => {
    expect(resolveTeamEntryRoute({ teamSlug: 'school', canCreateTeam: false })).toBe('/admin/school')
  })
  it('signed in with no team goes to the not-in-a-team page, never create-team', () => {
    expect(resolveTeamEntryRoute({ canCreateTeam: false })).toBe('/onboarding/no-team')
  })
  it('create-team opened directly without permission redirects; admin stays', () => {
    expect(resolveCreateTeamGuard(false)).toBe('/admin')
    expect(resolveCreateTeamGuard(true)).toBeNull()
  })
})
