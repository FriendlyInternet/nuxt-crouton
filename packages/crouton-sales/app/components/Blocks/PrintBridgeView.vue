<script setup lang="ts">
/**
 * Print Bridge Block — editor view (#127).
 *
 * NodeView placeholder for the page editor: a small mock of the bridge with
 * edit/delete controls, opens the property panel on double-click. Explicit
 * imports — VueNodeViewRenderer bypasses Nuxt auto-imports (mirrors the other
 * sales block views).
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface PrintBridgeAttrs {
  eventSlug?: string
}

const props = defineProps<{
  node: { attrs: PrintBridgeAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<PrintBridgeAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()
</script>

<template>
  <NodeViewWrapper data-type="print-bridge-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-printer"
      :label="t('sales.block.printBridge')"
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

      <!-- Mini bridge preview: a row of ticket cards with a print button -->
      <div class="bg-elevated/60 rounded-lg p-3 border border-default/60">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="tile in 3" :key="tile" class="rounded-md bg-default border border-default p-2 space-y-1.5">
            <div class="h-3 w-8 rounded bg-primary/30" />
            <div class="h-2 w-full rounded bg-gray-300/60 dark:bg-gray-700/60" />
            <div class="h-4 w-full rounded bg-primary/40 mt-1" />
          </div>
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
