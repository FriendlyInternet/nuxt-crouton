/**
 * Canonical email brand tokens — the single source of truth for the *identity*
 * shared across crouton-email's transactional Vue Email templates and the
 * standalone digest renderers (epic-digest, housekeeping).
 *
 * Why a plain `.mjs` (not `.ts`): the digest `render.mjs` scripts run in a
 * GitHub Action via bare `node render.mjs` with NO transpile and NO npm install
 * (the deliberate "dependency-free render" rail). They can only import plain
 * ESM, so this file must stay pure JS. The Vue Email SFCs import it too; a
 * sibling `email-brand.d.mts` gives them types.
 *
 * SCOPE: identity only — brand name, accent colour, canonical URL, logo, and
 * the sans-serif stack. This is NOT each surface's full visual system. The
 * transactional templates stay minimal/sans; epic-digest keeps its editorial
 * serif + rationed fluorescent palette + dark mode and only borrows the brand
 * name/URL (footer) and accent colour (masthead rule). One place to change the
 * identity, without homogenising designs that are deliberately different.
 */

/** Default brand display name. Apps override per-instance via runtime config. */
export const BRAND_NAME = 'Crouton'

/** Primary brand accent — emerald/teal. BaseLayout's accent rule + digest masthead. */
export const PRIMARY_COLOR = '#0F766E'

/**
 * A brightened accent for dark backgrounds (teal-400). The transactional
 * templates render on white and use {@link PRIMARY_COLOR}; epic-digest has a
 * near-black night mode where #0F766E goes muddy, so its accent flips to this.
 */
export const PRIMARY_COLOR_DARK = '#2dd4bf'

/** Canonical project URL (used in digest footers / brand links). */
export const BRAND_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'

/** Default logo URL. Empty → templates fall back to the wordmark. */
export const LOGO_URL = ''

/** Sans-serif system font stack used by the transactional templates. */
export const FONT_SANS
  = '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Roboto\', \'Oxygen\', \'Ubuntu\', \'Cantarell\', \'Fira Sans\', \'Droid Sans\', \'Helvetica Neue\', sans-serif'

/** Convenience object form (default export). */
export const brand = {
  name: BRAND_NAME,
  primaryColor: PRIMARY_COLOR,
  primaryColorDark: PRIMARY_COLOR_DARK,
  url: BRAND_URL,
  logoUrl: LOGO_URL,
  fontSans: FONT_SANS,
}

export default brand
