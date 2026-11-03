<script setup lang="ts">
/**
 * 3D Model Block Editor View
 *
 * NodeView component for rendering model blocks in the editor. Shows a static
 * preview (no live WebGL canvas, to keep the editor light) with edit/delete
 * controls. Double-click or the edit button opens the property panel.
 *
 * Note: Uses explicit imports because this component is loaded via
 * VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'

interface ModelBlockAttrs {
  src?: string
  title?: string
  background?: string
  autoRotate?: boolean
  height?: number
}

const props = defineProps<{
  node: { attrs: ModelBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<ModelBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const hasModel = computed(() => !!attrs.value.src)

const fileName = computed(() => {
  if (!attrs.value.src) return ''
  const parts = attrs.value.src.split('/')
  return decodeURIComponent(parts[parts.length - 1] || '')
})
</script>

<template>
  <NodeViewWrapper data-type="model-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-box"
      :label="'3D Model'"
      @delete="deleteNode"
    >
        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
          <!-- Warning if no model set -->
          <div
            v-if="!hasModel"
            class="flex items-center gap-2 text-amber-600 dark:text-amber-500"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-sm font-medium">No model set — choose a .glb/.gltf in properties</span>
          </div>

          <!-- Model info -->
          <div v-else class="space-y-2">
            <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white">
              {{ attrs.title }}
            </h3>

            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium max-w-full">
                <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <path d="m3.3 7 8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </svg>
                <span class="truncate">{{ fileName }}</span>
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ attrs.background || 'transparent' }}
              </span>
              <span v-if="attrs.height" class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ attrs.height }}px
              </span>
            </div>

            <!-- Visual placeholder -->
            <div class="mt-3 rounded bg-primary/5 border border-primary/10 flex items-center justify-center" style="height: 48px">
              <svg class="w-6 h-6 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <path d="m3.3 7 8.7 5 8.7-5" />
                <path d="M12 22V12" />
              </svg>
            </div>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
