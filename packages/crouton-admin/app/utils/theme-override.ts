/**
 * Deciders for a user's saved theme pick (`localStorage['nuxt-crouton-theme']`,
 * written by crouton-themes' useThemeSwitcher). Pure, so they're unit-tested
 * (test/theme-override.test.ts) — the team-theme plugin wires them up.
 *
 * `registered` is the app's built button variants
 * (`appConfig.ui.button.variants.variant`): a theme's classes only ship when its
 * layer is extended, so a pick is usable only if its variant is in there (#2257).
 */
import { THEME_PRESET_REGISTRY, type ThemePresetName } from '@fyit/crouton-themes/presets'

type RegisteredVariants = Record<string, unknown> | null | undefined

/** Is `name` a crouton theme this app actually ships? */
function isShipped(name: string, registered: RegisteredVariants): name is ThemePresetName {
  const check = THEME_PRESET_REGISTRY[name as ThemePresetName]?.checkVariant
  return !!check && !!registered && check in registered
}

/** The user's saved pick when it may apply, else null (absent / 'default' / locked / not shipped). */
export function pickThemeOverride(
  stored: string | null,
  allowUserThemes: boolean,
  registered: RegisteredVariants
): ThemePresetName | null {
  if (!allowUserThemes || !stored || stored === 'default') return null
  return isShipped(stored, registered) ? stored : null
}

/** Drop a saved pick that can't apply (team locked, or theme not shipped) so it can't resurface. */
export function shouldClearOverride(
  stored: string | null,
  allowUserThemes: boolean,
  registered: RegisteredVariants
): boolean {
  if (!stored || stored === 'default') return false
  return !allowUserThemes || !isShipped(stored, registered)
}
