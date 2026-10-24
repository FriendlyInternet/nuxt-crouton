/**
 * Block Visibility
 *
 * Pure helpers behind the universal `blockVisibility` attr — who sees a block,
 * and on what screen. Kept free of Vue and of any auth import so the renderer
 * can call them, tests can call them directly, and a future server-side
 * enforcement pass could call them unchanged.
 *
 * Two axes, resolved by two different mechanisms, for one reason: the public
 * page route is `swr: 3600` cached, so its HTML is shared across visitors.
 *
 * - **viewport** → CSS classes. Resolves per-device in the browser, so it is
 *   cache-safe, needs no JS, and cannot flicker.
 * - **audience/roles** → evaluated after hydration only. Reading auth state
 *   during SSR would bake one visitor's session into the shared cached HTML.
 *
 * NOT a security boundary. Every unusable value fails *open* (block shown) —
 * a corrupt attr should never blank a page. Gate sensitive content with the
 * page-level `visibility` field instead, which is enforced server-side.
 */
import type {
  BlockAudienceContext,
  BlockAudienceRole,
  BlockVisibility,
  BlockViewport
} from '../types/blocks'

const AUDIENCES = ['anonymous', 'authenticated'] as const
const ROLES: BlockAudienceRole[] = ['owner', 'admin', 'member']
const VIEWPORTS: BlockViewport[] = ['mobile', 'tablet', 'desktop']

/**
 * Which roles satisfy a required role. Owner outranks admin, mirroring the
 * page endpoint's own hierarchy (`[...slug].get.ts`, admin-visibility branch),
 * so an owner is never locked out of something an admin can see.
 */
const ROLE_SATISFIES: Record<BlockAudienceRole, BlockAudienceRole[]> = {
  owner: ['owner'],
  admin: ['owner', 'admin'],
  member: ['owner', 'admin', 'member']
}

/**
 * Tailwind class that hides a block on exactly one viewport band.
 *
 * These must stay whole literal strings — Tailwind scans source text, so a
 * class assembled at runtime would be purged from the build.
 */
const HIDE_ON: Record<BlockViewport, string> = {
  mobile: 'max-md:hidden',
  tablet: 'md:max-lg:hidden',
  desktop: 'lg:hidden'
}

/** Narrow an untrusted value to a known audience. */
function readAudience(value: unknown): BlockVisibility['audience'] | undefined {
  return (AUDIENCES as readonly string[]).includes(value as string)
    ? (value as BlockVisibility['audience'])
    : undefined
}

/** Narrow an untrusted value to the known roles, dropping anything unrecognised. */
function readRoles(value: unknown): BlockAudienceRole[] {
  if (!Array.isArray(value)) return []
  return value.filter((r): r is BlockAudienceRole => ROLES.includes(r as BlockAudienceRole))
}

/** Narrow an untrusted value to the known viewports, dropping anything unrecognised. */
function readViewports(value: unknown): BlockViewport[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is BlockViewport => VIEWPORTS.includes(v as BlockViewport))
}

/**
 * Read the stored attr, which may be an object (JSON content storage) or a
 * JSON string (the `data-block-visibility` HTML round-trip). Anything else
 * reads as "no visibility set".
 */
export function parseBlockVisibility(value: unknown): BlockVisibility | undefined {
  if (!value) return undefined

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as BlockVisibility)
        : undefined
    } catch {
      return undefined
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) return value as BlockVisibility

  return undefined
}

/**
 * Whether this block's display depends on who is looking.
 *
 * The renderer uses this to decide which blocks must wait for hydration.
 * A block with no visibility — or with only viewport limits, which CSS handles
 * — returns false and takes no new code path at all.
 */
export function hasAudienceGate(visibility: unknown): boolean {
  const vis = parseBlockVisibility(visibility)
  if (!vis) return false
  return readAudience(vis.audience) !== undefined || readRoles(vis.roles).length > 0
}

/**
 * Whether the current reader should see this block.
 *
 * Shows the block whenever the answer can't be determined: no visibility set,
 * an unrecognised stored value, or auth state that isn't knowable.
 */
export function matchesAudience(
  visibility: unknown,
  ctx: BlockAudienceContext
): boolean {
  const vis = parseBlockVisibility(visibility)
  if (!vis) return true

  const audience = readAudience(vis.audience)
  const roles = readRoles(vis.roles)

  // Naming roles implies the reader must be logged in.
  const requiresAuth = audience === 'authenticated' || roles.length > 0

  if (audience === 'anonymous') {
    // Unknowable auth state → show.
    return ctx.authenticated === null ? true : !ctx.authenticated
  }

  if (requiresAuth) {
    if (ctx.authenticated === null) return true
    if (!ctx.authenticated) return false

    if (roles.length > 0) {
      // Logged in but the role is unknown → show rather than lock out.
      if (!ctx.role) return true
      return roles.some(required => ROLE_SATISFIES[required].includes(ctx.role!))
    }
  }

  return true
}

/**
 * Classes that hide this block on the viewports it excludes.
 *
 * Emits one hide-class per *excluded* band, so allowing everything (or nothing
 * recognisable) emits nothing and the wrapper is untouched.
 */
export function viewportClasses(visibility: unknown): string[] {
  const vis = parseBlockVisibility(visibility)
  if (!vis) return []

  const allowed = readViewports(vis.viewports)

  // Empty means "no restriction" — either genuinely unset, or every entry was
  // unrecognised. Hiding all three would blank the block over a typo.
  if (allowed.length === 0) return []

  return VIEWPORTS.filter(v => !allowed.includes(v)).map(v => HIDE_ON[v])
}
