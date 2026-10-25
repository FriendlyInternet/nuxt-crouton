<script setup lang="ts">
/**
 * Section Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { SectionBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: SectionBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<SectionBlockAttrs>) => void
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
  <NodeViewWrapper data-type="section-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="t('pages.blockLibrary.section.name')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div>
          <p v-if="attrs.headline" class="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
            {{ attrs.headline }}
          </p>
          <h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title || t('pages.blockViews.sectionTitle') }}
          </h3>
          <p v-if="attrs.description" class="text-sm text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
            {{ attrs.description }}
          </p>
          <div v-if="attrs.features?.length" class="flex flex-wrap gap-1.5 mt-2">
            <span
              v-for="(feature, index) in attrs.features.slice(0, 4)"
              :key="index"
              class="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
            >
              {{ feature.title }}
            </span>
            <span v-if="attrs.features.length > 4" class="text-xs text-gray-400">
              {{ t('pages.blockViews.moreCount', { count: attrs.features.length - 4 }) }}
            </span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
