import { defineEventHandler, setResponseHeader } from 'h3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Layout: server-rpc/client.{ts,mjs} → ../client/{template.html,styles.css,app.js,tailwind.config.js}
//
// The asset read is LAZY (inside the handler) and GUARDED, not top-level. When a
// consuming app's Nitro bundles this handler, `import.meta.url` is rebased so
// `../client` can resolve to a directory that doesn't hold these assets (e.g.
// `<app>/.nuxt/client`). A top-level `readFileSync` there THROWS at module
// evaluation, which poisons the whole Nitro server entry — every route 500s with
// an ENOENT for `template.html`, not just this one. Reading on first request and
// degrading to a placeholder keeps the embedded tab a no-op instead of a
// server-wide crash (mirrors the events-handler ENOENT guard, #799).

let cached: string | null = null

function renderHtml(): string {
  if (cached !== null) return cached
  try {
    const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '../client')
    const template = readFileSync(resolve(clientDir, 'template.html'), 'utf8')
    const styles = readFileSync(resolve(clientDir, 'styles.css'), 'utf8')
    const appScript = readFileSync(resolve(clientDir, 'app.js'), 'utf8')
    const tailwindConfig = readFileSync(resolve(clientDir, 'tailwind.config.js'), 'utf8')
    cached = template
      .replace('{{STYLES}}', () => styles)
      .replace('{{APP_SCRIPT}}', () => appScript)
      .replace('{{TAILWIND_CONFIG}}', () => tailwindConfig)
  }
  catch {
    // Assets weren't shipped to the resolved location (consuming-app bundling).
    // Degrade to a placeholder so the route never crashes server boot.
    cached = '<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:1rem">'
      + 'Crouton DevTools embedded UI assets were not found in this build.</body>'
  }
  return cached
}

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
  return renderHtml()
})
