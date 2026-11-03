import { describe, it, expect } from 'vitest'
import { extractHowToTest, extractSteps, appFromFiles, hasOwnerOk, extractTargetPath, isSafePath, isGithubOnly } from '../server/utils/totest-core'

const body = `Closes #1

## 👤 Summary
Does a thing.

## 🧪 How to test
1. Open the page
2. Click **Go**
- bullet step

## Other
ignored`

describe('extractHowToTest', () => {
  it('returns the section up to the next heading', () => {
    const s = extractHowToTest(body)!
    expect(s).toContain('Open the page')
    expect(s).not.toContain('ignored')
  })
  it('returns null when absent or empty', () => {
    expect(extractHowToTest('## Summary\nx')).toBeNull()
    expect(extractHowToTest('## How to test\n\n## Next')).toBeNull()
    expect(extractHowToTest(null)).toBeNull()
  })
})

describe('extractSteps', () => {
  it('strips numbering and bullets', () => {
    expect(extractSteps(extractHowToTest(body))).toEqual(['Open the page', 'Click **Go**', 'bullet step'])
  })
})

describe('appFromFiles', () => {
  it('finds the first app or poc', () => {
    expect(appFromFiles(['README.md', 'pocs/status/a.ts', 'apps/velo/b.ts'])).toBe('status')
    expect(appFromFiles(['packages/x/y.ts'])).toBeNull()
  })
})

describe('hasOwnerOk', () => {
  it('only counts the owner', () => {
    expect(hasOwnerOk([{ body: 'ok', user: { login: 'bot' } }], 'pmcp')).toBe(false)
    expect(hasOwnerOk([{ body: 'LGTM thanks', user: { login: 'PMCP' } }], 'pmcp')).toBe(true)
  })
})

describe('extractTargetPath', () => {
  it('finds an app path in backticks', () => {
    expect(extractTargetPath(['Open `/__review?file=packages/a/B.vue` and look'])).toBe('/__review?file=packages/a/B.vue')
  })
  it('finds a bare path and trims trailing punctuation', () => {
    expect(extractTargetPath(['Go to /admin/bookings.'])).toBe('/admin/bookings')
  })
  it('accepts same-host URLs only', () => {
    expect(extractTargetPath(['Visit https://a.pmcp.dev/x/y?z=1'], 'https://a.pmcp.dev')).toBe('/x/y?z=1')
    expect(extractTargetPath(['Visit https://evil.com/x'], 'https://a.pmcp.dev')).toBe('')
  })
  it('ignores words like and/or and returns empty when nothing matches', () => {
    expect(extractTargetPath(['Check this and/or that'])).toBe('')
    expect(extractTargetPath([])).toBe('')
  })
})

describe('isSafePath', () => {
  it('accepts plain absolute paths', () => {
    expect(isSafePath('/admin?x=1')).toBe(true)
  })
  it('rejects protocol-relative, schemes, backslashes, relative', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'admin', '', '/a\nb', undefined]) {
      expect(isSafePath(bad)).toBe(false)
    }
  })
})

describe('isGithubOnly', () => {
  it('flags steps about the PR itself', () => {
    expect(isGithubOnly(['On this PR, the comment appears'])).toBe(true)
  })
  it('keeps app steps', () => {
    expect(isGithubOnly(['Open /admin', 'On this PR, see the diff'])).toBe(false)
    expect(isGithubOnly([])).toBe(false)
  })
})
