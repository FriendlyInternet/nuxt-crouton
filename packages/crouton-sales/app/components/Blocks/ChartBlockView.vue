<script setup lang="ts">
/**
 * Sales Chart Block Editor View
 *
 * NodeView component for rendering the sales chart block inside the page
 * editor. Shows which chart + scope is configured and opens the block
 * property panel on edit.
 *
 * Uses explicit imports because VueNodeViewRenderer bypasses Nuxt's
 * auto-import machinery.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { SALES_CHART_KINDS } from '../../utils/chart-blocks'

interface SalesChartBlockAttrs {
  chart?: string
  eventScope?: string
  chartTypeOverride?: string
  title?: string
  height?: number | string
}

const props = defineProps<{
  node: { attrs: SalesChartBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<SalesChartBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

const kind = computed(() => (attrs.value.chart ? SALES_CHART_KINDS[attrs.value.chart] : undefined))
const scopeLabel = computed(() => (attrs.value.eventScope ? t('sales.block.scopedEvent') : t('sales.block.allEvents')))
</script>

<template>
  <NodeViewWrapper data-type="sales-chart-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-chart-column"
      :label="t('sales.block.salesChart')"
      @delete="deleteNode"
    >
      <!-- Preview Content -->
      <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
        <!-- Nothing picked -->
        <div
          v-if="!kind"
          class="flex items-center gap-2 text-amber-600 dark:text-amber-500"
        >
          <UIcon name="i-lucide-triangle-alert" class="size-4" />
          <span class="text-sm font-medium">{{ t('sales.block.noChartPicked') }}</span>
        </div>

        <!-- Chart info -->
        <div v-else class="space-y-2">
          <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white">
            {{ attrs.title }}
          </h3>

          <div class="flex items-center gap-2 flex-wrap">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
              <UIcon :name="kind.icon" class="size-3.5" />
              {{ kind.label }}
            </span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
              <UIcon name="i-lucide-calendar" class="size-3" />
              {{ scopeLabel }}
            </span>
            <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs uppercase">
              {{ attrs.chartTypeOverride || kind.type }}
            </span>
          </div>

          <!-- Visual placeholder showing chart bars -->
          <div class="mt-3 flex items-end gap-1 h-12">
            <div class="flex-1 rounded-sm bg-primary/30" style="height: 60%" />
            <div class="flex-1 rounded-sm bg-primary/40" style="height: 85%" />
            <div class="flex-1 rounded-sm bg-primary/30" style="height: 45%" />
            <div class="flex-1 rounded-sm bg-primary/50" style="height: 100%" />
            <div class="flex-1 rounded-sm bg-primary/35" style="height: 70%" />
            <div class="flex-1 rounded-sm bg-primary/40" style="height: 55%" />
          </div>
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
