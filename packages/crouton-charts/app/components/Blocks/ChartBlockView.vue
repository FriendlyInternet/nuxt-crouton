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
import { computed, ref } from 'vue'
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

const innerRef = ref<HTMLElement | null>(null)

function findEditorId(): string | undefined {
  let el: HTMLElement | null = innerRef.value
  while (el) {
    if (el.classList?.contains('crouton-editor-blocks') && el.dataset?.editorId) {
      return el.dataset.editorId
    }
    el = el.parentElement
  }
  return undefined
}

function handleOpenPanel() {
  const editorId = findEditorId()
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos(), editorId }
  })
  document.dispatchEvent(event)
}

function handleWrapperClick() {
  // Touch devices have no hover reveal, so a single tap opens the panel directly.
  // Desktop keeps its dblclick-to-open + hover-reveal buttons behaviour unchanged.
  if (window.matchMedia('(pointer: coarse)').matches) {
    handleOpenPanel()
  }
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="chart-block"
    @dblclick="handleOpenPanel"
    @click="handleWrapperClick"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <!-- Block Content -->
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Chart
          </span>
          <!-- Action buttons -->
          <div class="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity flex items-center gap-0.5">
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              title="Edit block properties"
              @click.stop="handleOpenPanel"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              title="Delete block"
              @click.stop="deleteNode"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

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
      </div>
    </div>
  </NodeViewWrapper>
</template>
