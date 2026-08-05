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
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { useBlockEditRequest } from '../../composables/useBlockEditRequest'

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
    data-type="event-workspace-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-default transition-colors">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-muted uppercase tracking-wider">
              <UIcon name="i-lucide-layout-dashboard" class="size-3" />
              {{ t('sales.block.eventWorkspace') }}
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

        <!-- Mini workspace preview: tab strip over a list -->
        <div class="bg-muted/50 rounded-lg p-4 border border-default">
          <div class="flex gap-1.5 mb-3">
            <div class="h-4 w-16 rounded bg-primary/30" />
            <div v-for="tab in 3" :key="tab" class="h-4 w-16 rounded bg-accented" />
          </div>
          <div class="space-y-1.5">
            <div v-for="row in 3" :key="row" class="h-6 rounded bg-accented" />
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
