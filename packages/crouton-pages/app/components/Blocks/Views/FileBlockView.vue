<script setup lang="ts">
/**
 * File Block Editor View
 *
 * NodeView component for rendering file blocks in the editor.
 * Shows file info when set, placeholder when empty.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { FileBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: FileBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<FileBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const hasFile = computed(() => !!attrs.value.file)



</script>

<template>
  <NodeViewWrapper data-type="file-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-file-down"
      :label="t('pages.blocks.typeLabels.fileDownload')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <!-- File download preview -->
          <div v-if="hasFile" class="flex items-center gap-3 px-4 py-3">
            <svg class="w-5 h-5 text-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                {{ attrs.label || t('pages.blockRender.downloadFile') }}
              </p>
              <p v-if="attrs.fileName" class="text-xs text-gray-400 truncate">
                {{ attrs.fileName }}
              </p>
            </div>
          </div>

          <!-- Empty placeholder -->
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 py-8 text-gray-400"
          >
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 18 15 15" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blocks.file.noFile') }}</span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
