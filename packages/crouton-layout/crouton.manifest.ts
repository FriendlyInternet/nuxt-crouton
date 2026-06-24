import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

/**
 * @fyit/crouton-layout manifest.
 *
 * `bundled: true` makes the layout engine a default-on layer (like core/auth/
 * admin/i18n): `getCroutonLayers()` includes it unless a `crouton.config`
 * sets `features.layout: false`, and `crouton config` writes it into new apps'
 * `extends`. It contributes no field types of its own — it provides the layout
 * editor/renderer, the deterministic default-layout pass, the placeable blocks
 * and the `layout_configs` storage (populated by extraction epic #751).
 */
export default defineCroutonManifest({
  id: 'crouton-layout',
  name: 'Crouton Layout',
  description: 'Deterministic layout engine — editor, renderer, default-layout pass, placeable blocks, and layout_configs storage',
  icon: 'i-lucide-layout-dashboard',
  version: '1.0.0',
  category: 'core',
  bundled: true,
})
