// Theme preset registry — the SINGLE SOURCE for "themes available in apps"
// (#1332). crouton-admin's team Look-and-Feel picker consumes this instead of
// hand-copying theme configs (the old copy drifted: only bw/ko existed, its ko
// entry wrote compoundVariants at runtime — the deepAssign array hazard — and
// presets didn't reset each other's keys).
//
// Derived, not duplicated: metadata comes from AVAILABLE_THEMES, the applied
// `ui` payload IS the scalars-only THEME_UI_CONFIGS entry (colors +
// defaultVariants.variant per component — every config sets every owned key,
// so switching any preset to any other leaves nothing behind).

import { AVAILABLE_THEMES, type ThemeName } from '../composables/useThemeSwitcher'
import { THEME_UI_CONFIGS, type ThemeUIConfig } from './themeConfigs'

export interface ThemePresetEntry {
  /** Human label for the picker card */
  label: string
  /** One-line description for the picker card */
  description: string
  /** Hex swatches for the preview dots */
  previewPrimary: string
  previewNeutral: string
  /**
   * The named button variant this preset resolves to. Presence of this key in
   * the built app config's `ui.button.variants.variant` proves the theme's
   * LAYER is extended by the app — the preset is only usable then (classes and
   * CSS ship at build time; the runtime swap is scalars-only).
   */
  checkVariant: string
  /** Scalars-only payload for updateAppConfig({ ui }) */
  ui: ThemeUIConfig
  /** The scheme the theme is designed for (pin on apply, #1387) */
  colorMode?: 'light' | 'dark'
}

export type ThemePresetName = Exclude<ThemeName, 'default'>

export const THEME_PRESET_REGISTRY: Record<ThemePresetName, ThemePresetEntry>
  = Object.fromEntries(
    AVAILABLE_THEMES
      .filter(t => t.name !== 'default')
      .map((t) => {
        const ui = THEME_UI_CONFIGS[t.name]
        return [t.name, {
          label: t.label,
          description: t.description ?? '',
          previewPrimary: t.colors[0] ?? '#000000',
          previewNeutral: t.colors[1] ?? '#666666',
          checkVariant: ui?.button?.defaultVariants?.variant ?? t.name,
          ui: ui ?? {},
          colorMode: t.colorMode
        } satisfies ThemePresetEntry]
      })
  ) as Record<ThemePresetName, ThemePresetEntry>
