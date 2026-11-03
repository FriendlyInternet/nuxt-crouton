<script setup lang="ts">
/**
 * Product × Day Matrix Block Editor View
 *
 * NodeView preview for the page editor. Shows what the block is configured to
 * display and opens the property panel on edit. Uses explicit imports because
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface SalesProductMatrixAttrs {
  eventScope?: string
  measure?: 'units' | 'revenue'
  title?: string
}

const props = defineProps<{
  node: { attrs: SalesProductMatrixAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<SalesProductMatrixAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

const measureLabel = computed(() => (attrs.value.measure === 'revenue' ? t('sales.block.revenue') : t('sales.block.units')))
const scopeLabel = computed(() => (attrs.value.eventScope ? t('sales.block.scopedEvent') : t('sales.block.allEvents')))
</script>

<template>
  <NodeViewWrapper data-type="sales-product-matrix-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-table"
      :label="t('sales.block.productMatrix')"
      @delete="deleteNode"
    >
      <!-- Preview Content -->
      <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50 space-y-2">
        <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white">
          {{ attrs.title }}
        </h3>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
            <UIcon name="i-lucide-table" class="size-3.5" />
            {{ t('sales.block.productMatrix') }}
          </span>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
            <UIcon name="i-lucide-calendar" class="size-3" />
            {{ scopeLabel }}
          </span>
          <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
            {{ measureLabel }}
          </span>
        </div>
        <!-- Mini grid placeholder -->
        <div class="mt-2 grid grid-cols-5 gap-1">
          <div v-for="i in 15" :key="i" class="h-3 rounded-sm bg-gray-200/60 dark:bg-gray-700/40" />
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
