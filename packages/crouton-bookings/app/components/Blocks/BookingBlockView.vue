<script setup lang="ts">
/**
 * Booking Block Editor View
 *
 * NodeView component for rendering booking blocks in the editor.
 * Shows visual placeholder and edit controls.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface BookingBlockAttrs {
  title?: string
  emptyMessage?: string
  access?: 'public' | 'members'
  scope?: 'personal' | 'team'
}

const props = defineProps<{
  node: { attrs: BookingBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<BookingBlockAttrs>) => void
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
    data-type="booking-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 2v4M16 2v4M3 10h18M21 8v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="m9 16 2 2 4-4" />
              </svg>
              {{ t('bookings.block.booking') }}
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
              {{ t('bookings.block.membersOnly') }}
            </span>
            <!-- Scope badge -->
            <span
              v-if="attrs.scope === 'team'"
              class="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            >
              <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {{ t('bookings.block.teamView') }}
            </span>
          </div>
          <!-- Action buttons — UButton so themes reach them (#1410, same
               pattern as the crouton-pages block views) -->
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-pencil"
              class="text-dimmed hover:text-primary"
              :aria-label="t('bookings.block.editBlock')"
              :title="t('bookings.block.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-trash-2"
              class="text-dimmed hover:text-error"
              :aria-label="t('bookings.block.deleteBlock')"
              :title="t('bookings.block.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
          <!-- Title if set -->
          <h3 v-if="attrs.title" class="font-semibold text-gray-900 dark:text-white mb-2">
            {{ attrs.title }}
          </h3>

          <!-- Panel preview -->
          <div class="flex gap-3">
            <!-- Mini calendar grid -->
            <div class="grid grid-cols-7 gap-px w-28 shrink-0">
              <div
                v-for="d in 14"
                :key="d"
                class="h-3 rounded-sm"
                :class="d === 5 || d === 12
                  ? 'bg-primary/30'
                  : 'bg-gray-200/60 dark:bg-gray-700/40'"
              />
            </div>
            <!-- Mini booking list lines -->
            <div class="flex-1 space-y-1.5 pt-0.5">
              <div class="h-2.5 w-full rounded bg-gray-200/60 dark:bg-gray-700/40" />
              <div class="h-2.5 w-3/4 rounded bg-gray-200/60 dark:bg-gray-700/40" />
              <div class="h-2.5 w-5/6 rounded bg-gray-200/60 dark:bg-gray-700/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
