<script setup lang="ts">
/**
 * Shared chrome for editor-block NodeViews (#2414): selected border, label row,
 * edit + delete buttons, double-click to open the property panel.
 *
 * Tiptap stays out of core — the block keeps its own `<NodeViewWrapper>` and
 * renders this inside it. Components resolve in a NodeView template, so no
 * explicit import is needed for `<CroutonBlockFrame>`.
 *
 * Overrides: `#actions` (extra buttons), `#meta` (badges beside the label) and
 * `tapToOpen` (a tap inside the block opens the panel; off by default so the
 * cursor can still be placed).
 */
import { ref } from 'vue'
// Explicit import: NodeViews mount outside Nuxt's auto-import context
import { useBlockEditRequest } from '../composables/useBlockEditRequest'

const props = withDefaults(defineProps<{
  node: unknown
  getPos: () => number
  selected?: boolean
  icon?: string
  label: string
  tapToOpen?: boolean
}>(), {
  selected: false,
  tapToOpen: false
})

const emit = defineEmits<{ delete: [] }>()

const { t } = useT()
const innerRef = ref<HTMLElement | null>(null)
const { openPanel } = useBlockEditRequest(innerRef)

function handleOpen() {
  openPanel(props.node, props.getPos())
}
</script>

<template>
  <div
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    @dblclick="handleOpen"
    @click="tapToOpen && handleOpen()"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <UIcon v-if="icon" :name="icon" class="size-3" />
              {{ label }}
            </span>
            <slot name="meta" />
          </div>
          <div class="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity flex items-center gap-0.5">
            <slot name="actions" />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-pencil"
              class="text-dimmed hover:text-primary"
              :aria-label="t('common.edit')"
              :title="t('common.edit')"
              @click.stop="handleOpen"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-trash-2"
              class="text-dimmed hover:text-error"
              :aria-label="t('common.delete')"
              :title="t('common.delete')"
              @click.stop="emit('delete')"
            />
          </div>
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>
