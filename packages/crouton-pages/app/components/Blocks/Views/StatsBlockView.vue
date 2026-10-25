<script setup lang="ts">
/**
 * Stats Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { StatsBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: StatsBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<StatsBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)


</script>

<template>
  <NodeViewWrapper data-type="stats-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-bar-chart-3"
      :label="t('pages.blockLibrary.stats.name')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div>
          <h3 v-if="attrs.title" class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title }}
          </h3>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="(stat, index) in (attrs.stats || []).slice(0, 4)"
              :key="index"
              class="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
            >
              <span class="font-bold">{{ stat.prefix }}{{ stat.value }}{{ stat.suffix }}</span>
              <span class="text-gray-500 dark:text-gray-400">{{ stat.label }}</span>
            </span>
            <span v-if="(attrs.stats || []).length > 4" class="text-xs text-gray-400">
              {{ t('pages.blockViews.moreCount', { count: attrs.stats.length - 4 }) }}
            </span>
            <span v-if="!attrs.stats?.length" class="text-xs text-gray-400 italic">
              {{ t('pages.blockViews.noStats') }}
            </span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
