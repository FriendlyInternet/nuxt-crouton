import { describe, it, expect } from 'vitest'
import { isMagicLinkMode } from '../../app/utils/loginMode'

describe('isMagicLinkMode', () => {
  it('opens in link mode when passwords are off and magic link is on', () => {
    expect(isMagicLinkMode({ hasPassword: false, hasMagicLink: true, toggled: false })).toBe(true)
  })

  it('leaves password apps unchanged (follows the toggle)', () => {
    expect(isMagicLinkMode({ hasPassword: true, hasMagicLink: true, toggled: false })).toBe(false)
    expect(isMagicLinkMode({ hasPassword: true, hasMagicLink: true, toggled: true })).toBe(true)
    expect(isMagicLinkMode({ hasPassword: true, hasMagicLink: false, toggled: false })).toBe(false)
  })
})
