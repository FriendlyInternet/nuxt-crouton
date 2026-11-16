<script setup lang="ts">
/**
 * Chart Filters Block — editor view (#3928). A placeholder card: the real filters depend
 * on the preset charts on the page and appear on the published page.
 *
 * Explicit imports: loaded via VueNodeViewRenderer, which bypasses Nuxt auto-imports.
 */
import { NodeViewWrapper } from '@tiptap/vue-3'

defineProps<{ selected: boolean }>()
const { t } = useT()
</script>

<template>
  <NodeViewWrapper class="chart-filters-view" :class="{ 'is-selected': selected }" data-drag-handle>
    <div class="chart-filters-view-inner">
      <UIcon name="i-lucide-sliders-horizontal" class="size-5 text-muted" />
      <div>
        <p class="text-sm font-medium">{{ t('charts.blocks.filters.name') }}</p>
        <p class="text-xs text-muted">{{ t('charts.blocks.filters.editorHint') }}</p>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.chart-filters-view-inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 0.75rem;
}
.chart-filters-view.is-selected .chart-filters-view-inner { border-color: var(--ui-primary); }
</style>
