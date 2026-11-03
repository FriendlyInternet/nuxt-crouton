<script setup lang="ts">
/**
 * FAQ Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { FaqBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: FaqBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<FaqBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)


</script>

<template>
  <NodeViewWrapper data-type="faq-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="t('pages.blockLibrary.faq.name')"
      @delete="deleteNode"
    >

        <div>
          <p v-if="attrs.headline" class="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">
            {{ attrs.headline }}
          </p>
          <h3 class="text-base font-bold text-gray-900 dark:text-white mb-2">
            {{ attrs.title || t('pages.blockLibrary.faq.name') }}
          </h3>
          <div class="space-y-1">
            <div
              v-for="(item, index) in (attrs.items || []).slice(0, 3)"
              :key="index"
              class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
            >
              <UIcon name="i-lucide-chevron-right" class="size-3 text-gray-400 shrink-0" />
              <span class="truncate">{{ item.question }}</span>
            </div>
            <span v-if="(attrs.items || []).length > 3" class="text-xs text-gray-400 pl-5">
              {{ t('pages.blockViews.moreCount', { count: attrs.items.length - 3 }) }}
            </span>
            <span v-if="!attrs.items?.length" class="text-xs text-gray-400 italic">
              {{ t('pages.blockViews.noQuestions') }}
            </span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
