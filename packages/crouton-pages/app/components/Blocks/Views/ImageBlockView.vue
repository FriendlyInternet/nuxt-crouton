<script setup lang="ts">
/**
 * Image Block Editor View
 *
 * NodeView component for rendering image blocks in the editor.
 * Shows image preview when src is set, placeholder when empty.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { ImageBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: ImageBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<ImageBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const hasSrc = computed(() => !!attrs.value.src)



</script>

<template>
  <NodeViewWrapper data-type="image-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-image"
      :label="t('pages.blocks.typeLabels.image')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <!-- Image preview -->
          <div v-if="hasSrc" class="relative">
            <img
              :src="attrs.src"
              :alt="attrs.alt || ''"
              class="w-full max-h-64 object-contain"
            >
            <div v-if="attrs.caption" class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700/50">
              {{ attrs.caption }}
            </div>
          </div>

          <!-- Empty placeholder -->
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 py-8 text-gray-400"
          >
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blocks.noImage') }}</span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
