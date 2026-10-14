import { basename } from 'path'

const layerName = basename(__dirname)

export default defineNuxtConfig({
  components: {
    dirs: [
      {
        path: './components',
        prefix: layerName,
        global: true // Makes them available globally
      }
    ]
  },
  extends: [
    './collections/flows',
    './collections/inputs',
    './collections/outputs',
    './collections/discussions',
    './collections/tasks',
    './collections/jobs',
    './collections/users',
    './collections/messages',
    './collections/accounts'
  ]
})
