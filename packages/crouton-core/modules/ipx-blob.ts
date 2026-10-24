import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { defineNuxtModule } from '@nuxt/kit'

/**
 * Teaches IPX (used by @nuxt/image) how to find blob-stored images.
 *
 * Problem: Images uploaded to blob storage are served via `/images/[pathname]`
 * (a Nitro route). When Nuxt UI components like UPageLogos use <NuxtImg>,
 * IPX tries to find `/images/path.jpg` on the filesystem (public/) and fails.
 *
 * Solution (dev only):
 * 1. Add `.data/blob/` to IPX's fs.dir array so it can read blob files
 * 2. Alias `/images` → `/` so IPX strips the route prefix before lookup
 *
 * In production, IPX is typically replaced by edge image optimization
 * (Cloudflare Images, etc.) so this module only activates in dev.
 */
export default defineNuxtModule({
  meta: {
    name: 'crouton-core:ipx-blob',
  },
  setup(_options, nuxt) {
    if (!nuxt.options.dev) return

    nuxt.hook('nitro:init', (nitro) => {
      const ipxConfig = nitro.options.runtimeConfig?.ipx as Record<string, any> | undefined
      if (!ipxConfig) return

      // Derive blob dir from hub config (mirrors ensure-hub-blob.ts logic)
      const hub = (nuxt.options as Record<string, any>).hub ?? {}
      const dataDir = hub.dir || '.data'
      const blobDir = resolve(nuxt.options.rootDir, dataDir, 'blob')

      // Create it if absent: a fresh checkout has no uploads yet, and skipping
      // here left IPX blind to every image uploaded later in the session
      mkdirSync(blobDir, { recursive: true })

      // Append blob dir to IPX filesystem directories (alongside public/ dirs)
      const currentDirs = Array.isArray(ipxConfig.fs?.dir)
        ? ipxConfig.fs.dir
        : ipxConfig.fs?.dir ? [ipxConfig.fs.dir] : []

      ipxConfig.fs = ipxConfig.fs || {}
      ipxConfig.fs.dir = [...currentDirs, blobDir]

      // Alias /images → / so IPX strips the prefix before filesystem lookup
      // e.g. /images/photo.jpg → /photo.jpg → found at .data/blob/photo.jpg
      ipxConfig.alias = ipxConfig.alias || {}
      ipxConfig.alias['/images'] = '/'
    })
  },
})
