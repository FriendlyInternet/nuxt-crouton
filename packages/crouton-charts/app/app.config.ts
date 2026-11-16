import type { CroutonBlockDefinition } from '@fyit/crouton-core/app/types/block-definition'

const chartBlockDefinition: CroutonBlockDefinition = {
  type: 'chartBlock',
  name: 'Chart',
  description: 'Embed a collection as a chart (bar, line, area, donut)',
  icon: 'i-lucide-chart-bar',
  category: 'data',
  clientOnly: true,
  defaultAttrs: {
    mode: 'collection',
    collection: '',
    chartType: 'bar',
    height: 300,
    stacked: false
  },
  components: {
    editorView: 'CroutonChartsBlocksChartBlockView',
    renderer: 'CroutonChartsBlocksChartBlockRender'
  },
  propertyComponents: {
    'chart-preset': 'CroutonChartsBlocksChartPresetPicker'
  },
  schema: [
    {
      name: 'mode',
      type: 'select',
      label: 'Data source',
      options: [
        { label: 'Collection', value: 'collection' },
        { label: 'Preset', value: 'preset' }
      ],
      defaultValue: 'collection'
    },
    {
      name: 'preset',
      type: 'chart-preset',
      label: 'Chart Preset',
      description: 'Select a pre-configured chart from an installed package',
      visibleWhen: (attrs) => attrs.mode === 'preset'
    },
    {
      name: 'collection',
      type: 'collection',
      label: 'Collection',
      description: 'Select a collection to visualize',
      visibleWhen: (attrs) => !attrs.mode || attrs.mode === 'collection'
    },
    {
      name: 'chartType',
      type: 'select',
      label: 'Chart Type',
      options: [
        { label: 'Bar', value: 'bar' },
        { label: 'Line', value: 'line' },
        { label: 'Area', value: 'area' },
        { label: 'Donut', value: 'donut' }
      ],
      defaultValue: 'bar',
      visibleWhen: (attrs) => !attrs.mode || attrs.mode === 'collection'
    },
    {
      name: 'yFields',
      type: 'text',
      label: 'Y-axis fields',
      description: 'Comma-separated field names. Leave empty to auto-detect numeric fields.',
      visibleWhen: (attrs) => !attrs.mode || attrs.mode === 'collection'
    },
    {
      name: 'xField',
      type: 'text',
      label: 'X-axis field',
      description: 'Field for the X axis. Auto-resolved from collection title field if empty.',
      visibleWhen: (attrs) => !attrs.mode || attrs.mode === 'collection'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      description: 'Optional heading above the chart (overrides preset default)'
    },
    {
      name: 'height',
      type: 'select',
      label: 'Height',
      options: [
        { label: '200px', value: '200' },
        { label: '300px', value: '300' },
        { label: '400px', value: '400' },
        { label: '500px', value: '500' }
      ],
      defaultValue: '300'
    },
    {
      name: 'stacked',
      type: 'switch',
      label: 'Stacked',
      description: 'Stack series (bar and area charts only)',
      visibleWhen: (attrs) => !attrs.mode || attrs.mode === 'collection'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="chart-block"]',
    attributes: {
      mode: { default: 'collection' },
      preset: { default: undefined },
      collection: { default: '' },
      chartType: { default: 'bar' },
      xField: { default: undefined },
      yFields: { default: undefined },
      title: { default: undefined },
      height: { default: 300, htmlAttr: 'data-height', parseType: 'int' },
      stacked: { default: false, htmlAttr: 'data-stacked', parseType: 'boolean' }
    }
  }
}

// Filter bar for the preset charts on the same page (#3928). Labels are i18n keys
// (addon-block convention, resolved by crouton-pages' useBlockI18n).
const chartFiltersBlockDefinition: CroutonBlockDefinition = {
  type: 'chartFiltersBlock',
  name: 'charts.blocks.filters.name',
  description: 'charts.blocks.filters.description',
  icon: 'i-lucide-sliders-horizontal',
  category: 'data',
  clientOnly: true,
  defaultAttrs: {},
  components: {
    editorView: 'CroutonChartsBlocksChartFiltersBlockView',
    renderer: 'CroutonChartsBlocksChartFiltersBlockRender'
  },
  schema: [],
  tiptap: {
    parseHTMLTag: 'div[data-type="chart-filters-block"]',
    attributes: {}
  }
}

export default defineAppConfig({
  // App auto-discovery registration for crouton-charts
  croutonApps: {
    charts: {
      id: 'charts',
      name: 'Charts',
      icon: 'i-lucide-chart-bar',
      apiRoutes: [],
      adminRoutes: [],
      dashboardRoutes: [],
      settingsRoutes: []
    }
  },
  // Block definitions for the page editor
  croutonBlocks: {
    chartBlock: chartBlockDefinition,
    chartFiltersBlock: chartFiltersBlockDefinition
  }
})
