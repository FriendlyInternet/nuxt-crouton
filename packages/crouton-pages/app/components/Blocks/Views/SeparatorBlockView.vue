<script setup lang="ts">
/**
 * Separator Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { SeparatorBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: SeparatorBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<SeparatorBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)



</script>

<template>
  <NodeViewWrapper data-type="separator-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-minus"
      :label="t('pages.blockLibrary.separator.name')"
      @delete="deleteNode"
    >
      <div class="flex items-center gap-2">
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span v-if="attrs.label" class="text-xs text-gray-400 flex-shrink-0">
          {{ attrs.label }}
        </span>
        <div v-if="attrs.label" class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
