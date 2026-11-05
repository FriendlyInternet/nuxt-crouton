<script setup lang="ts">
/**
 * Mailing Block Editor View
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { MailingBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: MailingBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<MailingBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)


</script>

<template>
  <NodeViewWrapper data-type="mailing-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-mail"
      :label="t('pages.blockLibrary.mailing.name')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-800/50 w-full">
            <UIcon name="i-lucide-mail" class="size-4 text-gray-400 shrink-0" />
            <span v-if="attrs.title" class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              {{ attrs.title }}
            </span>
            <span v-else class="text-xs text-gray-400 italic">
              {{ t('pages.blockViews.noTitle') }}
            </span>
            <span v-if="attrs.actionUrl" class="ml-auto text-[10px] text-gray-400 truncate max-w-[200px]">
              {{ attrs.provider }}
            </span>
            <span v-else class="ml-auto text-[10px] text-amber-500">
              {{ t('pages.blockViews.noUrl') }}
            </span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
