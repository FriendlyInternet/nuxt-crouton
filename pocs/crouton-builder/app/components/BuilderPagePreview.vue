<script setup lang="ts">
/**
 * BuilderPagePreview — assembles the board's regions into the REAL page (spec: `page-regions-pin`).
 *
 * A page isn't one scrolling column: cards pinned to `top`/`bottom` become sticky bars and the ★
 * page renders in a scrolling main between them. This takes the board's nodes, groups them by
 * region, and renders each through the LIVE `CroutonLayoutRenderer` (real collections, real panes)
 * — safe here because this is a full-screen overlay, NOT a transform-scaled Vue Flow node (the
 * reason the board itself shows static thumbnails).
 *
 * This is the page-render half of region pinning — the thing that makes the pins testable: pin a
 * card top/bottom on the board, open Preview, and see it become a sticky bar.
 */
import { onMounted, onBeforeUnmount } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

defineProps<{
  top: LayoutNode[]
  main: LayoutNode | null
  bottom: LayoutNode[]
  title?: string
}>()
const emit = defineEmits<{ close: [] }>()

function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex flex-col bg-default text-default"
    role="dialog"
    aria-modal="true"
    aria-label="Page preview"
    data-handoff="page-preview"
  >
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-4 py-2">
      <UIcon name="i-lucide-eye" class="size-4 text-primary" />
      <span class="text-sm font-medium">Preview · {{ title || 'Page' }}</span>
      <span class="text-xs text-muted">pinned bars + scrolling main</span>
      <UButton
        class="ml-auto"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Close preview"
        @click="emit('close')"
      >
        Close
      </UButton>
    </header>

    <!-- The assembled page: sticky top bar(s) · scrolling main · sticky bottom bar(s). -->
    <div class="flex min-h-0 flex-1 flex-col">
      <div v-if="top.length" data-handoff="region-top" class="shrink-0 border-b border-default bg-elevated/40">
        <CroutonLayoutRenderer v-for="(n, i) in top" :key="`t-${i}`" :node="n" :interactive="false" />
      </div>

      <div class="min-h-0 flex-1 overflow-auto" data-handoff="region-main">
        <CroutonLayoutRenderer v-if="main" :node="main" :interactive="false" />
        <div v-else class="flex h-full items-center justify-center text-sm text-muted">
          No page node to render.
        </div>
      </div>

      <div v-if="bottom.length" data-handoff="region-bottom" class="shrink-0 border-t border-default bg-elevated/40">
        <CroutonLayoutRenderer v-for="(n, i) in bottom" :key="`b-${i}`" :node="n" :interactive="false" />
      </div>
    </div>
  </div>
</template>
