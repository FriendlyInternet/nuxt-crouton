import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'chores-chores',
  },
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'ChoresChores',
        global: true
      }
    ]
  }
})