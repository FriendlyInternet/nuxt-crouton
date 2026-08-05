<script setup lang="ts">
/**
 * BuilderFocusShell — the focus-edit VIEW (spec: `focus-edit-view`).
 *
 * Double-clicking a board node opens THIS full-screen overlay, not a Vue Flow camera
 * zoom (the camera zoom raced VF's re-measure and framed the node off-screen — the POC's
 * original bug). It hosts the graduated `CroutonLayoutBreakpointAuthor` (the min-width
 * ruler, device buttons, width slider, per-block widget variants, live splitter drags),
 * so pane editing happens here where the live renderer is SAFE to run — outside the
 * transform-scaled canvas node whose ResizeObserver loop OOM-crashes mobile Safari
 * (that's exactly why the board itself renders only static thumbnails).
 *
 * The overlay edits a LOCAL copy of the node's `LayoutTree`; 'Done' emits it back to the
 * board (which writes root + breakpoints onto the node and marks the board dirty), the
 * ✕ / Esc discards. Reuses `@fyit/crouton-layout` — no bespoke editor.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { LayoutNode, LayoutTree, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'

const props = defineProps<{
  node: LayoutNode
  breakpoints?: LayoutBreakpoint[]
  title?: string
  /** The card's authored on-screen width — the editor opens at THIS width (spec: focus-edit-view /
   *  per-element-resize), not the viewport default. Undefined for an unsized card (footprint width). */
  initialWidth?: number
}>()

const emit = defineEmits<{
  /** Commit the edited tree back onto the board node. */
  save: [tree: LayoutTree]
  /** Discard and close the overlay. */
  close: [] }>()

// Edit a LOCAL tree so ✕/Esc can discard cleanly — the board only sees it on 'Done'.
// The author emits fresh (immutable) trees, so a shallow seed is enough.
const localTree = ref<LayoutTree>({
  renderer: 'panes',
  root: props.node,
  breakpoints: props.breakpoints,
})

function onDone() {
  emit('save', localTree.value)
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex flex-col bg-default text-default"
    role="dialog"
    aria-modal="true"
    aria-label="Edit page layout"
    data-handoff="focus-edit"
  >
    <header class="flex items-center gap-3 border-b border-default px-4 py-2">
      <UButton
        icon="i-lucide-check"
        color="primary"
        variant="solid"
        size="sm"
        data-handoff="focus-done"
        @click="onDone"
      >
        Done
      </UButton>
      <span class="text-sm font-medium">
        Editing {{ title || 'layout' }}
      </span>
      <span class="text-xs text-muted">panes · breakpoints · variants</span>
      <UButton
        class="ml-auto"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Discard and close"
        @click="emit('close')"
      />
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <CroutonLayoutBreakpointAuthor v-model="localTree" :initial-width="initialWidth" />
    </div>
  </div>
</template>
