import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  base: './',
  build: { outDir: '../devframe-client-dist', emptyOutDir: true, target: 'esnext' }
})
