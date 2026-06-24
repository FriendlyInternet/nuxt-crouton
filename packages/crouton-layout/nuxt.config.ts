import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup deduplication guard (mirrors the other crouton layers)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-layout')) {
  _dependencies.add('crouton-layout')
}

/**
 * Nuxt Crouton Layout Layer (@fyit/crouton-layout)
 *
 * The deterministic layout engine, extracted from crouton-core (epic #751):
 * - the layout editor + renderer (`CroutonLayout*` components, prefix-preserved)
 * - the deterministic default-layout compose pass (`layout-compose` / `layout-viability` / `layout-tree` / `layout-edit`)
 * - the placeable layout blocks (`croutonLayoutBlocks` app.config registry — defaults: collection-list / entity-form / stats)
 * - the `layout_configs` storage (schema + GET/PUT API + the `/admin/[team]/layout` page — workstream #756)
 *
 * Dependency is strictly ONE-WAY: crouton-layout → crouton-core. The layout
 * TYPES (`LayoutTree`, `CroutonLayoutBlockRegistry`) deliberately stay in
 * crouton-core as the shared contract, so feature packages (crouton-bookings,
 * crouton-pages) keep importing them from core and need no dep on this layer.
 * Blocks are contributed via the `croutonLayoutBlocks` app.config registry.
 *
 * Default-on: `@fyit/crouton` includes this (bundled manifest), the same way
 * core auto-includes i18n/auth/admin.
 */
export default defineNuxtConfig({
  // One-way dependency: extend core (which already pulls i18n/auth/admin).
  extends: [
    '@fyit/crouton-core'
  ],

  // Components auto-import with the SAME Crouton* names they had in core
  // (Layout.vue → CroutonLayout, LayoutRenderer.vue → CroutonLayoutRenderer, …)
  // so no consuming app changes.
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'Crouton',
        global: true
      }
    ]
  },

  // Auto-import composables (useCroutonLayout{Blocks,Edit,Store}).
  // app/utils/* is auto-scanned by Nuxt's layer system (as in core).
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  }
})
