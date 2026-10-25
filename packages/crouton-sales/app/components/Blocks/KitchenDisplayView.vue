<script setup lang="ts">
/**
 * Kitchen Display Block — editor view (#61).
 *
 * NodeView component for the page editor: shows a placeholder (mock order
 * tiles) + edit/delete controls, opens the property panel on double-click.
 * Like the other sales block views, uses explicit imports —
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

interface KitchenDisplayAttrs {
  eventSlug?: string
}

const props = defineProps<{
  node: { attrs: KitchenDisplayAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<KitchenDisplayAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()
</script>

<template>
  <NodeViewWrapper data-type="kitchen-display-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-monitor"
      :label="t('sales.block.kitchenDisplay')"
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

      <!-- Mini KDS preview: a grid of order tiles, theme-driven (follows dark mode) -->
      <div class="bg-muted/50 rounded-lg p-3 ring ring-default">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="tile in 3" :key="tile" class="rounded-md bg-elevated/80 p-2 space-y-1.5">
            <div class="h-3 w-8 rounded bg-primary/40" />
            <div class="h-2 w-full rounded bg-accented/60" />
            <div class="h-2 w-3/4 rounded bg-accented/60" />
            <div class="h-3 w-full rounded bg-success/40 mt-1" />
          </div>
        </div>
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
