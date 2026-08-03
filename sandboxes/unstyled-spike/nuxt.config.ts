// Sandbox: what does `theme: { unstyled: true }` really cost a theme? (#1305,
// epic #1303). Throwaway, human-eyeball, delete-after — see sandboxes/CLAUDE.md.
//
// `unstyled: true` blanks EVERY slot/variant/compoundVariant class Nuxt UI would
// normally generate for EVERY component (verified against `@nuxt/ui@4.9.0` dist —
// `applyUnstyled()` runs at theme-template generation, before any app.config/`:ui`
// override is applied). What survives: `class=`, the `:ui` prop, and
// `app.config.ui` — because those are read separately from the generated
// variant/slot classes this flag blanks. This app restyles from that bare
// structure using ONLY those three surfaces, on purpose, to measure the re-supply
// cost documented in packages/crouton-themes/CLAUDE.md.
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3031 },

  ui: {
    theme: {
      unstyled: true
    }
  }
})
