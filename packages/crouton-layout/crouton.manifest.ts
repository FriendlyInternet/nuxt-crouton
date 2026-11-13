import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

/**
 * @fyit/crouton-layout manifest.
 *
 * `bundled: false` — the layout engine is opt-in (parked while it is
 * unfinished, #2282). An app turns it on by extending `@fyit/crouton-layout`;
 * `crouton init --features layout` adds it. It contributes no field types of its own — it provides the layout
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
    ],
  },
})
