<script setup lang="ts">
/**
 * BoardPane — one pane of the board: a leaf (or a read-only nested app) that
 * is also a drop target and carries the grip that moves it. Drop feedback comes
 * from the shared drag state (the drag resolves the pane under the pointer with
 * elementFromPoint), so this pane only compares paths.
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { NodePath, DropEdge } from '@fyit/crouton-layout/app/utils/layout-edit'
import { useBoardDrag, isWithin, samePath } from '~/utils/board-drag'

const props = defineProps<{
  node: LayoutNode
  path: NodePath
  selected: NodePath | null
}>()
const emit = defineEmits<{ select: [at: NodePath] }>()

const { blocks } = useCroutonLayoutBlocks()
const { payload, hover, arm, consumeClick } = useBoardDrag()

const isLeaf = computed(() => props.node.type === 'leaf')
const blockName = computed(() => (props.node.type === 'leaf' ? blocks.value[props.node.blockId]?.name ?? props.node.blockId : 'App'))
const isSelected = computed(() => !!props.selected && samePath(props.selected, props.path))

// A pane can't be dropped onto itself or into its own subtree.
const canAccept = computed(() => {
  const d = payload.value
  return !!d && !(d.kind === 'pane' && isWithin(props.path, d.path))
})
const hoverEdge = computed<DropEdge | null>(() =>
  hover.value && samePath(hover.value.path, props.path) ? hover.value.edge : null,
)

function onGripDown(e: PointerEvent) {
  arm(e, { kind: 'pane', path: props.path, label: blockName.value }, { holdMs: 150 })
}
</script>

<template>
  <div
    class="board-pane relative h-full w-full croutonpane"
    :class="{ 'board-pane--selected': isSelected, 'board-pane--target': canAccept }"
    :data-edge="hoverEdge ?? undefined"
    :data-path="path.join('.')"
    data-handoff="board-pane"
    @click="emit('select', path)"
  >
    <!-- A leaf renders through the package renderer (registry resolution, config
         sanitising, the admin fill-and-scroll); a nested app renders read-only. -->
    <CroutonLayoutRenderer v-if="isLeaf" :node="node" :interactive="true" />
    <CroutonLayoutRenderer v-else :node="(node as any).layout.root" :interactive="false" />

    <!-- Grab handle: hold briefly, then drag this pane onto another pane. -->
    <button
      type="button"
      class="board-grip absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md bg-elevated/90 px-1.5 py-1 text-[11px] text-muted shadow-sm backdrop-blur touch-none select-none cursor-grab active:cursor-grabbing"
      data-handoff="pane-grip"
      :aria-label="`Move ${blockName}`"
      @pointerdown="onGripDown"
      @click.stop="consumeClick() || emit('select', path)"
    >
      <span v-if="isSelected" class="max-w-28 truncate">{{ blockName }}</span>
      <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
    </button>

    <!-- Drop highlight: one bar on the hovered edge, or a ring for centre. -->
    <div v-if="hoverEdge" class="board-drop pointer-events-none absolute inset-0 z-20" :data-edge="hoverEdge" />
  </div>
</template>

<style scoped>
.croutonpane { container-type: inline-size; container-name: pane; }

.board-pane { outline: 1px solid transparent; outline-offset: -1px; transition: outline-color .15s; }
.board-pane--selected { outline-color: var(--ui-primary); }
.board-pane--target { outline-color: color-mix(in oklch, var(--ui-primary) 35%, transparent); }

/* The grip stays discreet until the pane is hovered / selected / being targeted. */
.board-grip { opacity: .55; transition: opacity .15s; -webkit-touch-callout: none; }
.board-pane:hover .board-grip, .board-pane--selected .board-grip { opacity: 1; }

/* Drop feedback: a thick bar on the chosen edge; a full ring means "replace / inside". */
.board-drop::before {
  content: ''; position: absolute; background: var(--ui-primary); border-radius: 3px; opacity: .9;
}
.board-drop[data-edge='left']::before   { left: 0; top: 0; bottom: 0; width: 6px; }
.board-drop[data-edge='right']::before  { right: 0; top: 0; bottom: 0; width: 6px; }
.board-drop[data-edge='top']::before    { top: 0; left: 0; right: 0; height: 6px; }
.board-drop[data-edge='bottom']::before { bottom: 0; left: 0; right: 0; height: 6px; }
.board-drop[data-edge='center']         { outline: 3px solid var(--ui-primary); outline-offset: -3px; border-radius: 6px; }
</style>
