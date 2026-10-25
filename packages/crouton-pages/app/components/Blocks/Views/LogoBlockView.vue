<script setup lang="ts">
/**
 * Logo Block Editor View
 *
 * NodeView component for rendering logo blocks in the editor.
 * Shows logo icon previews with the title.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { LogoBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: LogoBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<LogoBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)
const itemCount = computed(() => attrs.value.items?.length || 0)



</script>

<template>
  <NodeViewWrapper data-type="logo-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-user"
      :label="t('pages.blocks.typeLabels.logos')"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-700/50 p-4">
          <p v-if="attrs.title" class="text-sm font-semibold text-center text-gray-600 dark:text-gray-300 mb-3">
            {{ attrs.title }}
          </p>
          <div v-if="itemCount > 0" class="flex items-center justify-center gap-4 flex-wrap">
            <template v-for="(item, i) in attrs.items" :key="i">
              <!-- Icon-based logo -->
              <span
                v-if="item.type === 'icon' || (!item.type && item.value?.startsWith('i-'))"
                class="relative"
                :title="item.link ? `${item.value} → ${item.link}` : item.value"
              >
                <UIcon :name="item.value" class="size-8 text-gray-400" />
                <span v-if="item.link" class="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
              </span>
              <!-- Image-based logo -->
              <span
                v-else-if="item.value"
                class="relative"
                :title="item.link || ''"
              >
                <img
                  :src="item.value"
                  :alt="item.alt || ''"
                  class="h-6 object-contain opacity-60"
                >
                <span v-if="item.link" class="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
              </span>
            </template>
          </div>
          <div v-else class="text-center text-gray-400 text-sm py-2">
            {{ t('pages.blocks.logos.noLogos') }}
          </div>
          <div v-if="attrs.marquee || (attrs.align && attrs.align !== 'center') || (attrs.size && attrs.size !== 'md')" class="flex items-center justify-center gap-1 mt-2">
            <span v-if="attrs.marquee" class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{{ t('pages.blockLibrary.logo.fields.marquee.label') }}</span>
            <span v-if="attrs.align === 'between'" class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{{ t('pages.blockLibrary.logo.fields.align.options.between') }}</span>
            <span v-if="attrs.size && attrs.size !== 'md'" class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{{ attrs.size }}</span>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
