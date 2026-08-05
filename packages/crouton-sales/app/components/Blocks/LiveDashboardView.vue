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
import { useBlockEditRequest } from '../../composables/useBlockEditRequest'

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
const { openPanel } = useBlockEditRequest(innerRef)

function handleOpenPanel() {
  openPanel(props.node, props.getPos())
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="sales-live-dashboard-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-default transition-colors">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-muted uppercase tracking-wider">
              <UIcon name="i-lucide-layout-dashboard" class="size-3" />
              {{ t('sales.blocks.liveDashboard.name') }}
            </span>
            <span
              v-if="attrs.eventSlug"
              class="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
            >
              {{ attrs.eventSlug }}
            </span>
            <UBadge v-else color="warning" variant="subtle" class="text-[9px]">
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

        <!-- Preview: freshness pill + stat tiles + mini orders -->
        <div class="bg-muted/50 rounded-lg p-4 border border-default space-y-3">
          <div class="flex items-center justify-end">
            <UBadge color="success" variant="subtle" class="gap-1.5 text-[9px]">
              <span class="size-1.5 rounded-full bg-success" />
              {{ t('sales.sync.live') }}
            </UBadge>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div v-for="tile in 3" :key="tile" class="rounded-md bg-accented h-9" />
          </div>
          <div class="space-y-1.5">
            <div v-for="row in 3" :key="row" class="flex items-center gap-2 h-5 rounded bg-accented px-2">
              <span class="size-2 rounded-full bg-success/50 shrink-0" />
              <span class="h-2 flex-1 rounded bg-elevated" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
