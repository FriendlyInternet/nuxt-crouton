import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-charts',
  name: 'Charts',
  description: 'Chart visualizations powered by nuxt-charts, connected to collections',
  icon: 'i-lucide-chart-bar',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app needs data visualization, graphs, charts, analytics dashboards',
  dependencies: [],
  provides: {
    components: [
      {
        name: 'CroutonChartsWidget',
        description: 'Collection-driven chart component (bar, line, area, donut)'
      },
      { name: 'CroutonChartsBlocksChartBlockRender', description: 'Read-only public renderer for a chart editor block' },
      { name: 'CroutonChartsBlocksChartBlockView', description: 'Editor node view for a chart block' },
    ],
    composables: [
      { name: 'useCollectionChart', description: 'Fetch and transform collection data for charting' },
    ],
    editorBlocks: [
      { type: 'chartBlock', name: 'Chart', description: 'Embed a collection as a chart (bar, line, area, donut)', icon: 'i-lucide-chart-bar', category: 'data' }
    ],
  },
})
