import { describe, it, expect } from 'vitest'
import { resolveNoTeamRoute } from '../app/utils/no-team-route'

describe('resolveNoTeamRoute (#3130)', () => {
  it('stranger with no team (cannot create) goes home, never to the form', () => {
    expect(resolveNoTeamRoute(false)).toBe('/')
  })
  it('superAdmin with no team goes to create-team', () => {
    expect(resolveNoTeamRoute(true)).toBe('/onboarding/create-team')
  })
})
