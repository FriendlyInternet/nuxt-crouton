<script setup lang="ts">
/**
 * Video Block Editor View
 *
 * NodeView component for rendering video blocks in the editor.
 * Shows video preview when src is set, placeholder when empty.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { VideoBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: VideoBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<VideoBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)

const hasSrc = computed(() => !!attrs.value.src)

const isBunny = computed(() => {
  const src = attrs.value.src || ''
  return /iframe\.mediadelivery\.net/.test(src) || /\.b-cdn\.net/.test(src)
})

const bunnySrc = computed(() => {
  let url = attrs.value.src || ''
  url = url.replace('/play/', '/embed/')
  if (!url.includes('responsive=')) {
    url += (url.includes('?') ? '&' : '?') + 'responsive=true'
  }
  return url
})

const innerRef = ref<HTMLElement | null>(null)

function findEditorId(): string | undefined {
  let el: HTMLElement | null = innerRef.value
  while (el) {
    if (el.classList?.contains('crouton-editor-blocks') && el.dataset?.editorId) {
      return el.dataset.editorId
    }
    el = el.parentElement
  }
  return undefined
}

function handleOpenPanel() {
  const editorId = findEditorId()
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos(), editorId }
  })
  document.dispatchEvent(event)
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="video-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <!-- Block Content -->
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            {{ t('pages.blocks.typeLabels.video') }}
          </span>
          <!-- Action buttons -->
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-pencil"
              class="text-dimmed hover:text-primary"
              :aria-label="t('pages.blocks.editBlock')"
              :title="t('pages.blocks.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-trash-2"
              class="text-dimmed hover:text-error"
              :aria-label="t('pages.blocks.deleteBlock')"
              :title="t('pages.blocks.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

        <!-- Preview Content -->
        <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <!-- Video preview -->
          <div v-if="hasSrc" class="relative">
            <!-- Bunny Stream iframe preview -->
            <div v-if="isBunny" class="relative w-full" style="padding-bottom: 56.25%;">
              <iframe
                :src="bunnySrc"
                class="absolute inset-0 w-full h-full pointer-events-none"
                loading="lazy"
                style="border: none;"
              />
            </div>
            <!-- Native video preview -->
            <video
              v-else
              :src="attrs.src"
              muted
              class="w-full max-h-64 object-contain"
            />
            <div v-if="attrs.caption" class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700/50">
              {{ attrs.caption }}
            </div>
          </div>

          <!-- Empty placeholder -->
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 py-8 text-gray-400"
          >
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <span class="text-sm font-medium">{{ t('pages.blocks.video.noVideo') }}</span>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
