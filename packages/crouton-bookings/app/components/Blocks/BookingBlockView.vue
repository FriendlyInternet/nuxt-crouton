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
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface BookingBlockAttrs {
  title?: string
  emptyMessage?: string
  /** What a logged-out visitor sees (#2263). Older pages may still carry `access`. */
  loggedOut?: 'prompt' | 'hide'
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
</script>

<template>
  <NodeViewWrapper data-type="booking-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-calendar-check"
      :label="t('bookings.block.booking')"
      @delete="deleteNode"
    >
      <template #meta>
            <!-- Access badge -->
            <span
              v-if="attrs.loggedOut === 'hide'"
              class="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            >
              <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {{ t('bookings.block.hiddenWhenLoggedOut') }}
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
      </template>
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
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
