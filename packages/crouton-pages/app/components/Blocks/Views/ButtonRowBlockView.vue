<script setup lang="ts">
/**
 * Button Row Block Editor View
 *
 * NodeView component for rendering button row blocks in the editor.
 * Shows button labels as badges; placeholder when empty.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { ButtonRowBlockAttrs, ButtonRowItem } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: ButtonRowBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<ButtonRowBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const buttons = computed<ButtonRowItem[]>(() => {
  const raw = attrs.value.buttons
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) }
    catch { return [] }
  }
  return []
})

const hasButtons = computed(() => buttons.value.length > 0)



</script>

<template>
  <NodeViewWrapper data-type="button-row-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-rows-2"
      :label="t('pages.blockLibrary.buttonRow.name')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <!-- Button previews -->
          <div v-if="hasButtons" class="flex flex-wrap items-center gap-2 px-4 py-3">
            <span
              v-for="(btn, i) in buttons"
              :key="i"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border"
              :class="btn.download
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-300'
                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/50 text-blue-700 dark:text-blue-300'"
            >
              <svg v-if="btn.download" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              {{ btn.label || t('pages.untitled') }}
            </span>
          </div>

          <!-- Empty placeholder -->
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 py-8 text-gray-400"
          >
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="6" rx="1" />
              <rect x="3" y="15" width="18" height="6" rx="1" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blockViews.noButtons') }}</span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
