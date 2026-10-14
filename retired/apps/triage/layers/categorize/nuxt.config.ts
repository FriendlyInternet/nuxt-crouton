export default defineNuxtConfig({
  extends: [
    './collections/categorize-layouts'
  ],
  components: {
    dirs: [
      {
        path: './app/components',
        prefix: 'categorize',
        global: true,
      },
    ],
  },

  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' },
    ],
    langDir: './locales',
  },
})
