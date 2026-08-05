import { describe, it, expect } from 'vitest'
import {
  matchesAudience,
  viewportClasses,
  parseBlockVisibility,
  hasAudienceGate
} from '../app/utils/block-visibility'
import type { BlockVisibility, BlockAudienceContext } from '../app/types/blocks'

/** Reader contexts the renderer can hand the matcher. */
const ANON: BlockAudienceContext = { authenticated: false, role: null }
const MEMBER: BlockAudienceContext = { authenticated: true, role: 'member' }
const ADMIN: BlockAudienceContext = { authenticated: true, role: 'admin' }
const OWNER: BlockAudienceContext = { authenticated: true, role: 'owner' }
/** crouton-auth absent, or session not yet resolved. */
const UNKNOWN: BlockAudienceContext = { authenticated: null, role: null }

describe('matchesAudience — the untouched default', () => {
  it('shows a block with no visibility at all', () => {
    for (const ctx of [ANON, MEMBER, ADMIN, OWNER, UNKNOWN]) {
      expect(matchesAudience(undefined, ctx)).toBe(true)
    }
  })

  it('shows a block whose visibility sets only viewports', () => {
    const vis: BlockVisibility = { viewports: ['mobile'] }
    expect(matchesAudience(vis, ANON)).toBe(true)
    expect(matchesAudience(vis, ADMIN)).toBe(true)
  })
})

describe('matchesAudience — logged-out only (the QR case)', () => {
  const vis: BlockVisibility = { audience: 'anonymous' }

  it('shows to a logged-out reader', () => {
    expect(matchesAudience(vis, ANON)).toBe(true)
  })

  it('hides from every logged-in reader, whatever the role', () => {
    expect(matchesAudience(vis, MEMBER)).toBe(false)
    expect(matchesAudience(vis, ADMIN)).toBe(false)
    expect(matchesAudience(vis, OWNER)).toBe(false)
  })

  it('ignores roles — they are meaningless for an anonymous audience', () => {
    expect(matchesAudience({ audience: 'anonymous', roles: ['admin'] }, ANON)).toBe(true)
    expect(matchesAudience({ audience: 'anonymous', roles: ['admin'] }, ADMIN)).toBe(false)
  })
})

describe('matchesAudience — logged-in only', () => {
  const vis: BlockVisibility = { audience: 'authenticated' }

  it('hides from a logged-out reader', () => {
    expect(matchesAudience(vis, ANON)).toBe(false)
  })

  it('shows to any logged-in reader when no roles are named', () => {
    expect(matchesAudience(vis, MEMBER)).toBe(true)
    expect(matchesAudience(vis, ADMIN)).toBe(true)
    expect(matchesAudience(vis, OWNER)).toBe(true)
  })
})

describe('matchesAudience — roles', () => {
  it('hides from a reader whose role is not named', () => {
    expect(matchesAudience({ roles: ['admin'] }, MEMBER)).toBe(false)
  })

  it('shows to a reader whose role is named', () => {
    expect(matchesAudience({ roles: ['admin'] }, ADMIN)).toBe(true)
    expect(matchesAudience({ roles: ['member'] }, MEMBER)).toBe(true)
  })

  it('lets owner satisfy an admin check — owner outranks admin', () => {
    // Mirrors the page endpoint's own hierarchy
    // (server/api/teams/[id]/pages/[...slug].get.ts, admin-visibility branch).
    expect(matchesAudience({ roles: ['admin'] }, OWNER)).toBe(true)
  })

  it('does NOT let admin satisfy an owner-only check', () => {
    expect(matchesAudience({ roles: ['owner'] }, ADMIN)).toBe(false)
    expect(matchesAudience({ roles: ['owner'] }, OWNER)).toBe(true)
  })

  it('treats naming roles as implying authenticated', () => {
    expect(matchesAudience({ roles: ['member'] }, ANON)).toBe(false)
  })

  it('accepts a reader matching any one of several roles', () => {
    expect(matchesAudience({ roles: ['admin', 'member'] }, MEMBER)).toBe(true)
  })

  it('ignores an empty roles array — it names no restriction', () => {
    expect(matchesAudience({ audience: 'authenticated', roles: [] }, MEMBER)).toBe(true)
    expect(matchesAudience({ roles: [] }, ANON)).toBe(true)
  })
})

describe('matchesAudience — degrades to showing', () => {
  it('shows an audience-gated block when auth state is unknown', () => {
    // crouton-auth not installed, or the session has not resolved yet.
    expect(matchesAudience({ audience: 'anonymous' }, UNKNOWN)).toBe(true)
    expect(matchesAudience({ audience: 'authenticated' }, UNKNOWN)).toBe(true)
    expect(matchesAudience({ roles: ['admin'] }, UNKNOWN)).toBe(true)
  })

  it('shows when the reader is logged in but the role is unknown', () => {
    const noRole: BlockAudienceContext = { authenticated: true, role: null }
    expect(matchesAudience({ roles: ['admin'] }, noRole)).toBe(true)
    // The authenticated/anonymous split is still knowable, so it still applies.
    expect(matchesAudience({ audience: 'anonymous' }, noRole)).toBe(false)
  })

  it('fails open on a corrupt stored value — this is not a security boundary', () => {
    expect(matchesAudience({ audience: 'nonsense' } as any, MEMBER)).toBe(true)
    expect(matchesAudience({ roles: 'admin' } as any, MEMBER)).toBe(true)
    expect(matchesAudience({ roles: ['bogus'] } as any, MEMBER)).toBe(true)
    expect(matchesAudience(null as any, MEMBER)).toBe(true)
    expect(matchesAudience('junk' as any, MEMBER)).toBe(true)
  })
})

describe('viewportClasses — one hidden-class per excluded viewport', () => {
  it('emits nothing when every viewport is allowed', () => {
    expect(viewportClasses(undefined)).toEqual([])
    expect(viewportClasses({})).toEqual([])
    expect(viewportClasses({ viewports: [] })).toEqual([])
    expect(viewportClasses({ viewports: ['mobile', 'tablet', 'desktop'] })).toEqual([])
  })

  it('hides the two larger viewports for a mobile-only block', () => {
    expect(viewportClasses({ viewports: ['mobile'] })).toEqual(['md:max-lg:hidden', 'lg:hidden'])
  })

  it('hides everything below desktop for a desktop-only block', () => {
    expect(viewportClasses({ viewports: ['desktop'] })).toEqual(['max-md:hidden', 'md:max-lg:hidden'])
  })

  it('hides the gap for a mobile+desktop block', () => {
    expect(viewportClasses({ viewports: ['mobile', 'desktop'] })).toEqual(['md:max-lg:hidden'])
  })

  it('hides mobile for a tablet+desktop block', () => {
    expect(viewportClasses({ viewports: ['tablet', 'desktop'] })).toEqual(['max-md:hidden'])
  })

  it('is order-insensitive', () => {
    expect(viewportClasses({ viewports: ['desktop', 'mobile'] })).toEqual(['md:max-lg:hidden'])
  })

  it('ignores unknown viewport names rather than hiding everything', () => {
    expect(viewportClasses({ viewports: ['mobile', 'watch'] } as any)).toEqual(['md:max-lg:hidden', 'lg:hidden'])
  })

  it('emits nothing when the stored value is corrupt', () => {
    expect(viewportClasses({ viewports: 'mobile' } as any)).toEqual([])
    expect(viewportClasses({ viewports: ['bogus'] } as any)).toEqual([])
    expect(viewportClasses(null as any)).toEqual([])
  })
})

describe('hasAudienceGate — decides which blocks defer past hydration', () => {
  it('is false for a block with no visibility, so it renders as it always did', () => {
    expect(hasAudienceGate(undefined)).toBe(false)
    expect(hasAudienceGate({})).toBe(false)
  })

  it('is false for a viewport-only block — CSS needs no deferral', () => {
    expect(hasAudienceGate({ viewports: ['mobile'] })).toBe(false)
  })

  it('is true when an audience or roles are named', () => {
    expect(hasAudienceGate({ audience: 'anonymous' })).toBe(true)
    expect(hasAudienceGate({ audience: 'authenticated' })).toBe(true)
    expect(hasAudienceGate({ roles: ['admin'] })).toBe(true)
  })

  it('is false for restrictions that name nothing', () => {
    expect(hasAudienceGate({ roles: [] })).toBe(false)
    expect(hasAudienceGate({ audience: 'nonsense' } as any)).toBe(false)
  })
})

describe('parseBlockVisibility — the stored attr is untrusted', () => {
  it('reads an object straight through', () => {
    expect(parseBlockVisibility({ audience: 'anonymous' })).toEqual({ audience: 'anonymous' })
  })

  it('reads the JSON string form written into data-block-visibility', () => {
    expect(parseBlockVisibility('{"audience":"anonymous","viewports":["mobile"]}'))
      .toEqual({ audience: 'anonymous', viewports: ['mobile'] })
  })

  it('returns undefined for absent or unusable values', () => {
    expect(parseBlockVisibility(undefined)).toBeUndefined()
    expect(parseBlockVisibility(null)).toBeUndefined()
    expect(parseBlockVisibility('')).toBeUndefined()
    expect(parseBlockVisibility('not json')).toBeUndefined()
    expect(parseBlockVisibility('[1,2]')).toBeUndefined()
    expect(parseBlockVisibility(42)).toBeUndefined()
  })
})
