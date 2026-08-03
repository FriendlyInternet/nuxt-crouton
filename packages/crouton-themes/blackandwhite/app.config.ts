import { subtractThemeDefaults } from '../lib/subtractive'

// Black & White theme layer config.
//
// House rule (matches every other theme, e.g. brutalist/app.config.ts): a theme
// LAYER app.config carries ONLY `colors` (its palette — reset at runtime by
// themeConfigs.ts → defaultConfig) plus per-component `slots.base: replacer` +
// named `variants`. It must NOT set standard-variant `defaultVariants`, a global
// `theme` size, or app-level component overrides (container / navigationMenu /
// dashboardPanel) — those are merged into the CONSUMING app's global Nuxt UI
// config on `extends` and would apply on EVERY theme, including default, with no
// runtime reset (the kassa/fanfare leak, #1525). The scalar defaultVariants swap
// for bw (subtle inputs etc.) lives in themeConfigs.ts, which resets on switch.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'neutral'
    },
    button: {
      // NAMED bw-* variants + a defaultVariants pointer (#1304, was an override
      // of the standard solid/outline/... slots). A plain <UButton> in a
      // single-theme bw app (extending only this layer, no runtime switcher)
      // resolves to bw-solid; in a multi-theme app the runtime themeConfigs swap
      // owns the default. The standard variants stay untouched, so this layer no
      // longer restyles other themes' buttons, and an explicit variant="outline"
      // is the author's literal choice. The shared marker-gated replacer (#1304)
      // strips the conflicting defaults (color/elevation/motion/underline) when a
      // bw-* marker is present, so the CSS needs no !important; Nuxt UI's
      // rounding, sizing and focus ring are kept.
      slots: {
        base: subtractThemeDefaults
      },
      defaultVariants: {
        variant: 'bw-solid'
      },
      variants: {
        variant: {
          'bw-solid': 'bw-solid',
          'bw-outline': 'bw-outline',
          'bw-soft': 'bw-soft',
          'bw-ghost': 'bw-ghost',
          'bw-link': 'bw-link'
        }
      }
    }
  }
})
