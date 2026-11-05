<script setup lang="ts">
/**
 * Live Dashboard block — editor view (#179, epic #175).
 *
 * NodeView component for the page editor: a static preview (freshness pill +
 * stat tiles + mini orders list) with edit/delete controls; double-click opens
 * the property panel. Like the other sales block views, uses explicit imports —
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface LiveDashboardAttrs {
  eventSlug?: string
  title?: string
}

const props = defineProps<{
  node: { attrs: LiveDashboardAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<LiveDashboardAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()
</script>

<template>
  <NodeViewWrapper data-type="sales-live-dashboard-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-layout-dashboard"
      :label="t('sales.blocks.liveDashboard.name')"
      @delete="deleteNode"
    >
      <template #meta>
        <span
          v-if="attrs.eventSlug"
          class="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
        >
          {{ attrs.eventSlug }}
        </span>
        <span
          v-else
          class="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        >
          {{ t('sales.block.noEventPicked') }}
        </span>
      </template>

      <!-- Preview: freshness pill + stat tiles + mini orders -->
      <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50 space-y-3">
        <div class="flex items-center justify-end">
          <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
            <span class="size-1.5 rounded-full bg-emerald-500" />
            {{ t('sales.sync.live') }}
          </span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div v-for="tile in 3" :key="tile" class="rounded-md bg-gray-200/60 dark:bg-gray-700/40 h-9" />
        </div>
        <div class="space-y-1.5">
          <div v-for="row in 3" :key="row" class="flex items-center gap-2 h-5 rounded bg-gray-200/60 dark:bg-gray-700/40 px-2">
            <span class="size-2 rounded-full bg-emerald-500/50 shrink-0" />
            <span class="h-2 flex-1 rounded bg-gray-300/60 dark:bg-gray-600/40" />
          </div>
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
