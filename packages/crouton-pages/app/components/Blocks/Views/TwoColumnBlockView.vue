<script setup lang="ts">
/**
 * Two Column Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { TwoColumnBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: TwoColumnBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<TwoColumnBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const splitLabel = computed(() => {
  const map: Record<string, string> = {
    '1/2': '50 / 50',
    '1/3': '33 / 67',
    '2/3': '67 / 33'
  }
  return map[attrs.value.split || '1/2'] ?? '50 / 50'
})


</script>

<template>
  <NodeViewWrapper data-type="two-column-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="`${t('pages.blockLibrary.twoColumn.name')} · ${splitLabel}`"
      @delete="deleteNode"
    >

        <!-- Simplified two-column preview -->
        <div class="grid gap-2" :class="attrs.split === '1/3' ? 'grid-cols-[1fr_2fr]' : attrs.split === '2/3' ? 'grid-cols-[2fr_1fr]' : 'grid-cols-2'">
          <div class="bg-gray-50 dark:bg-gray-800/50 rounded p-2 min-h-[48px]">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ attrs.leftTitle || t('pages.blockViews.leftColumn') }}
            </p>
            <p v-if="attrs.leftDescription" class="text-[11px] text-gray-400 truncate mt-0.5">
              {{ attrs.leftDescription }}
            </p>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800/50 rounded p-2 min-h-[48px]">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ attrs.rightTitle || t('pages.blockViews.rightColumn') }}
            </p>
            <p v-if="attrs.rightDescription" class="text-[11px] text-gray-400 truncate mt-0.5">
              {{ attrs.rightDescription }}
            </p>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
