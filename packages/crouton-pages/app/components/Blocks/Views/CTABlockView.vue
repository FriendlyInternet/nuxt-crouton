<script setup lang="ts">
/**
 * CTA Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { CTABlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: CTABlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<CTABlockAttrs>) => void
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
  <NodeViewWrapper data-type="cta-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="t('pages.blocks.typeLabels.cta')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="text-center">
          <h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">
            {{ attrs.title || t('pages.blockLibrary.cta.name') }}
          </h3>
          <p v-if="attrs.description" class="text-sm text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
            {{ attrs.description }}
          </p>
          <div v-if="attrs.links?.length" class="flex justify-center gap-1.5">
            <span
              v-for="(link, index) in attrs.links"
              :key="index"
              class="px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded text-xs"
            >
              {{ link.label }}
            </span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
