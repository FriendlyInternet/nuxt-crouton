<script setup lang="ts">
/**
 * Chart Block Editor View
 *
 * NodeView component for rendering chart blocks in the editor.
 * Shows a preview of the block with edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { ChartBlockAttrs } from '../../utils/chart-constants'

const props = defineProps<{
  node: { attrs: ChartBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<ChartBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)

const chartTypeLabels: Record<string, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  donut: 'Donut'
}

const chartTypeDisplay = computed(() => chartTypeLabels[attrs.value.chartType] || 'Bar')

// Read preset info from shared registry state
const chartPresets = useState<Array<{ id: string; name: string; config: { type?: string } }>>('crouton-chart-presets', () => [])
const resolvedPreset = computed(() => {
  if (attrs.value.mode !== 'preset' || !attrs.value.preset) return null
  return chartPresets.value.find(p => p.id === attrs.value.preset) || null
})
const isPresetMode = computed(() => attrs.value.mode === 'preset')
const sourceLabel = computed(() => {
  if (isPresetMode.value) return resolvedPreset.value?.name || attrs.value.preset || 'No preset'
  return attrs.value.collection || 'No collection'
})
const typeLabel = computed(() => {
  if (isPresetMode.value && resolvedPreset.value) {
    return chartTypeLabels[resolvedPreset.value.config.type || ''] || resolvedPreset.value.config.type || 'Bar'
  }
  return chartTypeDisplay.value
})
</script>

<template>
  <NodeViewWrapper data-type="chart-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-bar-chart-3"
      :label="'Chart'"
      @delete="deleteNode"
    >
        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
          <!-- Warning if nothing selected -->
          <div
            v-if="(isPresetMode && !attrs.preset) || (!isPresetMode && !attrs.collection)"
            class="flex items-center gap-2 text-amber-600 dark:text-amber-500"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-sm font-medium">{{ isPresetMode ? 'No preset selected' : 'No collection selected' }}</span>
          </div>

          <!-- Chart info -->
          <div v-else class="space-y-2">
            <!-- Title if set -->
            <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white">
              {{ attrs.title }}
            </h3>

            <!-- Badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                {{ sourceLabel }}
              </span>
              <span
                v-if="isPresetMode"
                class="inline-flex items-center px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-xs"
              >
                preset
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ typeLabel }}
              </span>
              <span v-if="attrs.height" class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ attrs.height }}px
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
