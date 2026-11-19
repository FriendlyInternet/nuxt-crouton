export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // MCP sign-in e2e fixture (#4096). French first: the consent page is reached
  // by a full page load from the MCP client's flow, so it renders in the default
  // locale, and the copy under test ("Une application", Autoriser/Refuser) is
  // the French one.
  locales: ['fr', 'en'],
  defaultLocale: 'fr',

  // No collections: this fixture only exercises crouton-auth's OAuth provider.
  collections: [],

  targets: [],

  dialect: 'sqlite'
}
