export default {
  // No `locales` override → crouton's default English UI, so the shared e2e auth
  // helpers (which match English button labels like "Sign in" / "Create account")
  // work. fanfare runs this domain nl-only for product reasons; the fixture only
  // needs the sales/printing behaviour, which is locale-agnostic.

  // Feature flags - which crouton packages to enable.
  // Sales drives the full POS + printing domain (no pages collection here —
  // the fixture exercises sales/printing, not crouton-pages).
  features: {
    sales: { config: { print: { enabled: true } } }
  },

  // The sales collections ship with @fyit/crouton-sales (#2278) — nothing to
  // generate here.
  collections: [],
  targets: [],

  dialect: 'sqlite'
}