import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// Real Nuxt runtime (real useFetch / useAsyncData) for the layout renderer (#3753).
// Without `rootDir` the Nuxt test env boots the process cwd (the monorepo root) as the app.
export default defineVitestConfig({
  test: {
    name: 'crouton-layout:nuxt-runtime',
    environment: 'nuxt',
    include: ['*.test.ts'],
    environmentOptions: {
      nuxt: { rootDir: fileURLToPath(new URL('.', import.meta.url)) }
    }
  }
})
