import { describe, it, expect } from 'vitest'
import { describeGenerateStep } from '../../lib/init-app'

// #4377 — init said "no collections in config yet" for ANY generate error.
describe('describeGenerateStep (#4377)', () => {
  it('T4a. 0 collections → the "no collections" wording', () => {
    const s = describeGenerateStep({ collectionCount: 0 })
    expect(s.generated).toBe(false)
    expect(s.step2).toContain('no collections in config yet')
    expect(s.step3).toContain('No collections generated')
  })

  it('T4b. an error with 3 collections → Generate failed + the message, never "no collections"', () => {
    const s = describeGenerateStep({ collectionCount: 3, error: new Error('schema index clash') })
    expect(s.generated).toBe(false)
    expect(s.step2).toContain('Generate failed')
    expect(s.step2).toContain('3 collections')
    expect(s.step2).toContain('schema index clash')
    expect(s.step2).not.toContain('no collections')
    expect(s.step3).toContain('Generate failed')
    expect(s.step3).not.toContain('No collections generated')
  })

  it('T4c. no error → generated', () => {
    const s = describeGenerateStep({ collectionCount: 3 })
    expect(s.generated).toBe(true)
    expect(s.step2).toContain('Collections generated')
  })
})
