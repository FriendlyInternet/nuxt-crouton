<script setup lang="ts">
/**
 * Live Dashboard block — editor view (#179, epic #175).
 *
 * NodeView component for the page editor: a static preview (freshness pill +
 * stat tiles + mini orders list) with edit/delete controls; double-click opens
 * the property panel. Like the other sales block views, uses explicit imports —
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface LiveDashboardAttrs {
  eventSlug?: string
  title?: string
}

const props = defineProps<{
  node: { attrs: LiveDashboardAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<LiveDashboardAttrs>) => void
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
    data-type="sales-live-dashboard-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
              {{ t('sales.blocks.liveDashboard.name') }}
            </span>
            <span
              v-if="attrs.eventSlug"
              class="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
            >
              {{ attrs.eventSlug }}
            </span>
            <span
              v-else
              class="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            >
              {{ t('sales.block.noEventPicked') }}
            </span>
          </div>
          <div class="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity flex items-center gap-0.5">
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              :title="t('sales.block.editBlock')"
              @click.stop="handleOpenPanel"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              :title="t('sales.block.deleteBlock')"
              @click.stop="deleteNode"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Preview: freshness pill + stat tiles + mini orders -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50 space-y-3">
          <div class="flex items-center justify-end">
            <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              <span class="size-1.5 rounded-full bg-emerald-500" />
              {{ t('sales.sync.live') }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div v-for="tile in 3" :key="tile" class="rounded-md bg-gray-200/60 dark:bg-gray-700/40 h-9" />
          </div>
          <div class="space-y-1.5">
            <div v-for="row in 3" :key="row" class="flex items-center gap-2 h-5 rounded bg-gray-200/60 dark:bg-gray-700/40 px-2">
              <span class="size-2 rounded-full bg-emerald-500/50 shrink-0" />
              <span class="h-2 flex-1 rounded bg-gray-300/60 dark:bg-gray-600/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
