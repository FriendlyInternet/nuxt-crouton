<script setup lang="ts">
/**
 * BoardDropBar (#3916) — the drop bar for a target that is not a single pane: the
 * page's edge or a group's outer edge. A pane draws its own bar (BoardPane); a page
 * or group has no element of its own to draw on, so this one fixed element sits over
 * the target's on-screen rect (already clipped to the board frame) and draws the same
 * 6 px bar on its edge.
 */
import { useBoardDrag } from '~/utils/board-drag'

const { hover } = useBoardDrag()

const target = computed(() => (hover.value && hover.value.scope !== 'pane' ? hover.value : null))
const style = computed(() => {
  const r = target.value?.rect
  if (!r) return undefined
  return { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` }
})
</script>

<template>
  <div
    v-if="target"
    class="board-drop-bar pointer-events-none fixed z-40"
    :style="style"
    data-handoff="board-drop-bar"
    :data-scope="target.scope"
    :data-edge="target.edge"
  />
</template>

<style scoped>
.board-drop-bar::before {
  content: ''; position: absolute; background: var(--ui-primary); border-radius: 3px; opacity: .9;
}
.board-drop-bar[data-edge='left']::before   { left: 0; top: 0; bottom: 0; width: 6px; }
.board-drop-bar[data-edge='right']::before  { right: 0; top: 0; bottom: 0; width: 6px; }
.board-drop-bar[data-edge='top']::before    { top: 0; left: 0; right: 0; height: 6px; }
.board-drop-bar[data-edge='bottom']::before { bottom: 0; left: 0; right: 0; height: 6px; }
</style>
