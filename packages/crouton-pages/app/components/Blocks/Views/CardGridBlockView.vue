<script setup lang="ts">
/**
 * Card Grid Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { CardGridBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: CardGridBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<CardGridBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

// Reference to inner element for finding parent editor

// Find the editor ID by traversing up the DOM

// Handler that opens property panel by dispatching a custom event
</script>

<template>
  <NodeViewWrapper data-type="card-grid-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="t('pages.blocks.typeLabels.cards')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div>
          <p v-if="attrs.headline" class="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">
            {{ attrs.headline }}
          </p>
          <h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title || t('pages.blockLibrary.cardGrid.name') }}
          </h3>
          <p v-if="attrs.description" class="text-sm text-gray-500 dark:text-gray-400 mb-2 line-clamp-1">
            {{ attrs.description }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="(card, index) in (attrs.cards || []).slice(0, 4)"
              :key="index"
              class="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
            >
              {{ card.title }}
            </span>
            <span v-if="(attrs.cards || []).length > 4" class="text-xs text-gray-400">
              {{ t('pages.blockViews.moreCount', { count: attrs.cards.length - 4 }) }}
            </span>
            <span v-if="!attrs.cards?.length" class="text-xs text-gray-400 italic">
              {{ t('pages.blockViews.noCards') }}
            </span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
