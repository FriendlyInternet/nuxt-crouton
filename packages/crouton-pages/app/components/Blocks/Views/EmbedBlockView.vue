<script setup lang="ts">
/**
 * Embed Block Editor View
 *
 * NodeView component for rendering embed blocks in the editor.
 * Shows a preview card with the URL and provider info.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { EmbedBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: EmbedBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<EmbedBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const hasUrl = computed(() => !!attrs.value.url)

const providerLabel = computed(() => {
  const url = attrs.value.url || ''
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube'
  if (url.includes('figma.com')) return 'Figma'
  if (attrs.value.provider === 'youtube') return 'YouTube'
  if (attrs.value.provider === 'figma') return 'Figma'
  return t('pages.blockLibrary.embed.name')
})

const truncatedUrl = computed(() => {
  const url = attrs.value.url || ''
  return url.length > 60 ? url.slice(0, 57) + '…' : url
})



</script>

<template>
  <NodeViewWrapper data-type="embed-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-tv"
      :label="providerLabel"
      @delete="deleteNode"
    >

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
          <!-- Warning if no URL set -->
          <div
            v-if="!hasUrl"
            class="flex items-center gap-2 text-amber-600 dark:text-amber-500"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blocks.embed.noUrl') }}</span>
          </div>

          <!-- URL info -->
          <div v-else class="space-y-2">
            <!-- Badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                  <polyline points="17 2 12 7 7 2" />
                </svg>
                {{ providerLabel }}
              </span>
              <span v-if="attrs.height" class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                {{ attrs.height }}px
              </span>
            </div>

            <!-- URL display -->
            <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate" :title="attrs.url">
              {{ truncatedUrl }}
            </p>

            <!-- Visual placeholder -->
            <div class="mt-3 rounded bg-primary/5 border border-primary/10 flex items-center justify-center" style="height: 48px">
              <svg class="w-6 h-6 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                <polyline points="17 2 12 7 7 2" />
              </svg>
            </div>
          </div>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
