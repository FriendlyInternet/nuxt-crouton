<script setup lang="ts">
/**
 * Map Block Editor View
 *
 * NodeView component for rendering map blocks in the editor.
 * Shows a preview of the block with edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'

interface MapBlockAttrs {
  address?: string
  lat: number
  lng: number
  zoom: number
  style: string
  height: number
  markerLabel?: string
}

const props = defineProps<{
  node: { attrs: MapBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<MapBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)

const hasLocation = computed(() => {
  const lat = Number(attrs.value.lat)
  const lng = Number(attrs.value.lng)
  return lat !== 0 || lng !== 0
})

const { t } = useT()

const styleLabels = computed<Record<string, string>>(() => ({
  streets: t('maps.styles.streets'),
  light: t('maps.styles.light'),
  dark: t('maps.styles.dark'),
  satellite: t('maps.styles.satellite'),
  outdoors: t('maps.styles.outdoors')
}))

const styleLabel = computed(() => styleLabels.value[attrs.value.style] || attrs.value.style || t('maps.styles.streets'))
</script>

<template>
  <NodeViewWrapper data-type="map-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-map-pin"
      :label="t('maps.block.map')"
      @delete="deleteNode"
    >
        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
          <!-- Warning if no location set -->
          <div
            v-if="!hasLocation"
            class="flex items-center gap-2 text-amber-600 dark:text-amber-500"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-sm font-medium">{{ t('maps.block.noLocationHint') }}</span>
          </div>

          <!-- Location info -->
          <div v-else class="space-y-2">
            <!-- Place name if set -->
            <h3 v-if="attrs.address" class="font-semibold text-gray-900 dark:text-white">
              {{ attrs.address }}
            </h3>

            <!-- Badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {{ Number(attrs.lat).toFixed(4) }}, {{ Number(attrs.lng).toFixed(4) }}
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ styleLabel }}
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ t('maps.block.zoom', { zoom: attrs.zoom }) }}
              </span>
              <span v-if="attrs.height" class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ attrs.height }}px
              </span>
            </div>

            <!-- Visual placeholder -->
            <div class="mt-3 rounded bg-primary/5 border border-primary/10 flex items-center justify-center" style="height: 48px">
              <svg class="w-6 h-6 text-primary/40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
            </div>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
