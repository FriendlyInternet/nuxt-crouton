<script setup lang="ts">
/**
 * Kitchen Display Block — editor view (#61).
 *
 * NodeView component for the page editor: shows a placeholder (mock order
 * tiles) + edit/delete controls, opens the property panel on double-click.
 * Like the other sales block views, uses explicit imports —
 * VueNodeViewRenderer bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { useBlockEditRequest } from '../../composables/useBlockEditRequest'

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

const innerRef = ref<HTMLElement | null>(null)
const { openPanel } = useBlockEditRequest(innerRef)

function handleOpenPanel() {
  openPanel(props.node, props.getPos())
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="kitchen-display-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-default transition-colors">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-muted uppercase tracking-wider">
              <UIcon name="i-lucide-chef-hat" class="size-3" />
              {{ t('sales.block.kitchenDisplay') }}
            </span>
            <span
              v-if="attrs.eventSlug"
              class="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
            >
              {{ attrs.eventSlug }}
            </span>
            <UBadge v-else color="warning" variant="subtle" size="sm">
              {{ t('sales.block.noEventPicked') }}
            </UBadge>
          </div>
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              :title="t('sales.block.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-trash-2"
              :title="t('sales.block.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

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
      </div>
    </div>
  </NodeViewWrapper>
</template>
