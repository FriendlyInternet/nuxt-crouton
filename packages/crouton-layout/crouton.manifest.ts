import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

/**
 * @fyit/crouton-layout manifest.
 *
 * `bundled: false` means not shipped inside crouton-core (core can't extend
 * this layer — circular). It is on by default via `crouton init` (#3955);
 * `crouton init --no-layout` leaves it out. An app has it by extending
 * `@fyit/crouton-layout`. It contributes no field types of its own — it provides the layout
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
  bundled: false,
})
