<script setup lang="ts">
/**
 * Triage Block Editor View
 *
 * NodeView component for rendering triage blocks in the editor.
 * Shows visual placeholder with pipeline diagram and edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface TriageBlockAttrs {
  title?: string
  emptyMessage?: string
  limit?: number | string
  access?: 'public' | 'members'
}

const props = defineProps<{
  node: { attrs: TriageBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<TriageBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

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
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="triage-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              {{ t('triage.block.triage') }}
            </span>
            <!-- Access badge -->
            <span
              v-if="attrs.access === 'members'"
              class="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            >
              <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {{ t('triage.block.membersOnly') }}
            </span>
          </div>
          <!-- Action buttons -->
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              :title="t('triage.block.editBlock')"
              @click.stop="handleOpenPanel"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              :title="t('triage.block.deleteBlock')"
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
          <!-- Title if set -->
          <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white mb-2">
            {{ attrs.title }}
          </h3>

          <!-- Mini pipeline diagram -->
          <div class="flex items-center gap-2 mb-3">
            <div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <div class="w-2 h-2 rounded-full bg-blue-400" />
            </div>
            <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <div class="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <div class="w-2 h-2 rounded-full bg-violet-400" />
            </div>
            <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <div class="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <div class="w-2 h-2 rounded-full bg-green-400" />
            </div>
          </div>

          <!-- Feed skeleton lines -->
          <div class="space-y-1.5">
            <div class="h-2.5 w-full rounded bg-gray-200/60 dark:bg-gray-700/40" />
            <div class="h-2.5 w-3/4 rounded bg-gray-200/60 dark:bg-gray-700/40" />
            <div class="h-2.5 w-5/6 rounded bg-gray-200/60 dark:bg-gray-700/40" />
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
