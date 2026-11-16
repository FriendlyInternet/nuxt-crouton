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
  provides: {
    components: [
      { name: 'CroutonLayout', description: 'The editable panes surface' },
      { name: 'CroutonLayoutBreakpointAuthor', description: 'Breakpoints level of the Crouton Builder: author responsiveness by demonstration' },
      { name: 'CroutonLayoutCollection', description: 'Data-bound list block for a layout' },
      { name: 'CroutonLayoutForm', description: 'Data-bound form block: the detail half of a master/detail layout' },
      { name: 'CroutonLayoutRenderer', description: 'Renders a layout data tree into resizable, nestable panes' },
      { name: 'CroutonLayoutSpikeStats', description: 'Throwaway stats block from the layout spike (#713); goes when the spike does.' },
      { name: 'CroutonLayoutStoreScope', description: 'Owns the layout store copies that the layouts rendered inside it read; wrap a page\'s layouts in it.' },
    ],
  },
})
