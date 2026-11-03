<script setup lang="ts">
/**
 * Standalone Clients block — editor view.
 *
 * NodeView component for the page editor: shows a placeholder (mock client-tab
 * rows) + edit/delete controls, opens the property panel on double-click.
 * Like the other sales block views, uses explicit imports —
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface ClientsAttrs {
  eventSlug?: string
}

const props = defineProps<{
  node: { attrs: ClientsAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<ClientsAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()
</script>

<template>
  <NodeViewWrapper data-type="sales-clients-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-users"
      :label="t('sales.block.clients')"
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

    <!-- Mini clients preview: client-tab rows with a trailing amount pill. -->
    <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
      <div class="space-y-1.5">
        <div v-for="row in 3" :key="row" class="flex items-center gap-2 h-6 rounded bg-gray-200/60 dark:bg-gray-700/40 px-2">
          <span class="size-3 rounded-full bg-gray-300/70 dark:bg-gray-600/50 shrink-0" />
          <span class="h-2 flex-1 rounded bg-gray-300/60 dark:bg-gray-600/40" />
          <span class="h-3 w-10 rounded bg-primary/30 shrink-0" />
        </div>
      </div>
    </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
