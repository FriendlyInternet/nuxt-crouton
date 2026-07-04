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
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

defineProps<{
  top: LayoutNode[]
  main: LayoutNode | null
  bottom: LayoutNode[]
  title?: string
}>()
const emit = defineEmits<{ close: [] }>()

// See the assembled page at different screen widths — the same width idea as the edit view, but
// applied to the WHOLE page (regions), read-only. The frame constrains width; the renderer's
// `@container` reflow does the rest (no separate slider to build — it reuses the render primitive).
const DEVICES = [
  { label: 'Full', width: null, icon: 'i-lucide-maximize-2' },
  { label: 'Phone', width: 390, icon: 'i-lucide-smartphone' },
  { label: 'Tablet', width: 768, icon: 'i-lucide-tablet' },
  { label: 'Laptop', width: 1024, icon: 'i-lucide-laptop' },
  { label: 'Desktop', width: 1440, icon: 'i-lucide-monitor' },
] as const
const simWidth = ref<number | null>(null) // null = full width

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
    <header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-4 py-2">
      <UIcon name="i-lucide-eye" class="size-4 text-primary" />
      <span class="text-sm font-medium">Preview · {{ title || 'Page' }}</span>

      <!-- width control — see the assembled page at each device width (reuses the render primitive). -->
      <div class="flex items-center gap-1" data-handoff="preview-devices">
        <UButton
          v-for="d in DEVICES"
          :key="d.label"
          :icon="d.icon"
          size="xs"
          :color="simWidth === d.width ? 'primary' : 'neutral'"
          :variant="simWidth === d.width ? 'soft' : 'ghost'"
          :aria-label="d.label"
          @click="simWidth = d.width"
        />
        <span class="ml-1 font-mono text-xs text-muted">{{ simWidth ? `${simWidth}px` : 'full' }}</span>
      </div>

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

    <!-- The assembled page scrolls like a NORMAL PAGE: the FRAME is the single scroller, the ★ page
         content flows at its natural height (region-main is content-height, so the renderer's h-full
         panes resolve to auto and flow — one scrollbar, not a nested pane-per-scroller app shell),
         and pinned top/bottom regions become true sticky bars over that one scroll. -->
    <div class="min-h-0 flex-1 overflow-hidden p-3" :class="simWidth ? 'bg-muted/20' : ''">
      <div
        class="mx-auto flex h-full flex-col overflow-y-auto bg-default"
        :style="simWidth
          ? { width: `${simWidth}px`, maxWidth: '100%', border: '1px solid var(--ui-border)', borderRadius: '0.6rem', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }
          : { width: '100%' }"
        data-handoff="preview-frame"
      >
        <div v-if="top.length" data-handoff="region-top" class="sticky top-0 z-10 shrink-0 border-b border-default bg-elevated/95 backdrop-blur">
          <CroutonLayoutRenderer v-for="(n, i) in top" :key="`t-${i}`" :node="n" :interactive="false" />
        </div>

        <div data-handoff="region-main">
          <CroutonLayoutRenderer v-if="main" :node="main" :interactive="false" />
          <div v-else class="flex min-h-48 items-center justify-center text-sm text-muted">
            No page node to render.
          </div>
        </div>

        <div v-if="bottom.length" data-handoff="region-bottom" class="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-default bg-elevated/95 backdrop-blur">
          <CroutonLayoutRenderer v-for="(n, i) in bottom" :key="`b-${i}`" :node="n" :interactive="false" />
        </div>
      </div>
    </div>
  </div>
</template>
