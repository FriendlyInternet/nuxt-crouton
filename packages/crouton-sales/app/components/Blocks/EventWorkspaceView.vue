<script setup lang="ts">
/**
 * Event Workspace Block Editor View
 *
 * NodeView component for rendering the event workspace block inside the page
 * editor. Like the other sales blocks: shows a placeholder (mock tab strip +
 * list) + edit/delete controls, opens the property panel on double-click.
 *
 * Uses explicit imports — VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface EventWorkspaceAttrs {
  eventSlug?: string
}

const props = defineProps<{
  node: { attrs: EventWorkspaceAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<EventWorkspaceAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()
</script>

<template>
  <NodeViewWrapper data-type="event-workspace-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-box"
      :label="t('sales.block.eventWorkspace')"
      @delete="deleteNode"
    >
      <template #meta>
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
      </template>

      <!-- Mini workspace preview: tab strip over a list -->
      <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
        <div class="flex gap-1.5 mb-3">
          <div class="h-4 w-16 rounded bg-primary/30" />
          <div v-for="tab in 3" :key="tab" class="h-4 w-16 rounded bg-gray-200/60 dark:bg-gray-700/40" />
        </div>
        <div class="space-y-1.5">
          <div v-for="row in 3" :key="row" class="h-6 rounded bg-gray-200/60 dark:bg-gray-700/40" />
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
