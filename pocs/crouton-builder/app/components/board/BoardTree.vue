<script setup lang="ts">
/**
 * BoardTree (#2375) — the page board as a plain DOM splitter tree.
 *
 * Recurses the LayoutTree the same way the package renderer does (split → reka
 * SplitterGroup / Panel / ResizeHandle; leaf → the registered block component),
 * and adds the ONE thing the renderer doesn't have: every pane knows its own
 * `NodePath`, so it can be a drop target. Drops use native browser drag events
 * — the pane computes left / right / top / bottom / centre from its own rect on
 * each `dragover`, highlights that edge, and emits on `drop`. The tree only
 * changes when the parent applies the emitted drop. No pointer capture, no
 * dwell timer, no ghost spliced into the tree.
 *
 * Deliberately in the POC (consume-vs-grow): once it holds up on a phone, the
 * splitter + drop layer is the candidate for extraction into crouton-layout.
 */
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { NodePath, DropEdge } from '@fyit/crouton-layout/app/utils/layout-edit'
import { useBoardDrag, edgeFor, isWithin, samePath, type BoardDragPayload } from '~/utils/board-drag'

defineOptions({ name: 'BoardTree' })

const props = withDefaults(defineProps<{
  node: LayoutNode
  path?: NodePath
  selected?: NodePath | null
}>(), { path: () => [], selected: null })

const emit = defineEmits<{
  drop: [at: NodePath, edge: DropEdge, payload: BoardDragPayload]
  resize: [at: NodePath, sizes: number[]]
  select: [at: NodePath]
}>()

const { blocks, resolveComponentName, sanitizeConfig } = useCroutonLayoutBlocks()
const { dragging, start, end } = useBoardDrag()

const isLeaf = computed(() => props.node.type === 'leaf')
const componentName = computed(() => (props.node.type === 'leaf' ? resolveComponentName(props.node.blockId) : null))
const safeConfig = computed(() => (props.node.type === 'leaf' ? sanitizeConfig(props.node.blockId, props.node.config) : {}))
const isSelected = computed(() => !!props.selected && samePath(props.selected, props.path))

// A pane can't be dropped onto itself or into its own subtree.
const canAccept = computed(() => {
  const d = dragging.value
  if (!d) return false
  if (d.kind === 'pane' && isWithin(props.path, d.path)) return false
  return true
})

// ── drop target ──────────────────────────────────────────────────────────────
const hoverEdge = ref<DropEdge | null>(null)
const paneEl = ref<HTMLElement | null>(null)

function onDragOver(e: DragEvent) {
  if (!canAccept.value || !paneEl.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  hoverEdge.value = edgeFor(e, paneEl.value.getBoundingClientRect())
}
function onDragLeave(e: DragEvent) {
  // Leaving to a child element still counts as "over"; only clear when truly out.
  if (paneEl.value && e.relatedTarget instanceof Node && paneEl.value.contains(e.relatedTarget)) return
  hoverEdge.value = null
}
function onDrop(e: DragEvent) {
  if (!canAccept.value || !paneEl.value) return
  e.preventDefault()
  e.stopPropagation()
  const edge = edgeFor(e, paneEl.value.getBoundingClientRect())
  const payload = dragging.value
  hoverEdge.value = null
  if (payload) emit('drop', props.path, edge, payload)
}

// ── drag source (the pane's grab handle) ─────────────────────────────────────
function onHandleDragStart(e: DragEvent) {
  start(e, { kind: 'pane', path: props.path })
}
function onHandleDragEnd() {
  end()
}

// Split sizes come back from reka as percentages, in child order.
function onLayout(sizes: number[]) {
  emit('resize', props.path, sizes)
}

const panelMin = (child: LayoutNode) => child.minSize ?? 10
const panelDefault = (child: LayoutNode, n: number) => child.defaultSize ?? 100 / n
const blockName = computed(() => (props.node.type === 'leaf' ? blocks.value[props.node.blockId]?.name ?? props.node.blockId : ''))
</script>

<template>
  <!-- Split: one reka group, recursing per child with the child's path. -->
  <SplitterGroup
    v-if="node.type === 'split'"
    :direction="node.direction"
    class="h-full w-full"
    @layout="onLayout"
  >
    <template v-for="(child, i) in node.children" :key="i">
      <SplitterResizeHandle
        v-if="i > 0"
        class="relative shrink-0 bg-border hover:bg-primary data-[state=drag]:bg-primary transition-colors data-[orientation=horizontal]:w-1.5 data-[orientation=vertical]:h-1.5"
        data-handoff="pane-resize-handle"
      />
      <SplitterPanel
        :default-size="panelDefault(child, node.children.length)"
        :min-size="panelMin(child)"
        class="overflow-hidden"
      >
        <BoardTree
          :node="child"
          :path="[...path, i]"
          :selected="selected"
          @drop="(at, edge, payload) => emit('drop', at, edge, payload)"
          @resize="(at, sizes) => emit('resize', at, sizes)"
          @select="at => emit('select', at)"
        />
      </SplitterPanel>
    </template>
  </SplitterGroup>

  <!-- Leaf or nested: a container-query pane that is also a drop target. -->
  <div
    v-else
    ref="paneEl"
    class="board-pane relative h-full w-full croutonpane"
    :class="{ 'board-pane--selected': isSelected, 'board-pane--target': canAccept }"
    :data-edge="hoverEdge ?? undefined"
    :data-path="path.join('.')"
    data-handoff="board-pane"
    @dragover="onDragOver"
    @dragenter.prevent
    @dragleave="onDragLeave"
    @drop="onDrop"
    @click="emit('select', path)"
  >
    <template v-if="isLeaf">
      <component
        :is="componentName"
        v-if="componentName"
        v-bind="safeConfig"
        class="h-full w-full overflow-auto"
      />
      <div v-else class="h-full w-full flex items-center justify-center p-4 text-sm text-error text-center">
        Unknown block: <code>{{ (node as any).blockId }}</code>
      </div>
    </template>
    <CroutonLayoutRenderer
      v-else
      :node="(node as any).layout.root"
      :interactive="false"
    />

    <!-- Grab handle: the drag source for moving this pane. Native drag, so the
         browser draws the drag image and the tree is untouched until drop. -->
    <button
      type="button"
      class="board-grip absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md bg-elevated/90 px-1.5 py-1 text-[11px] text-muted shadow-sm backdrop-blur touch-none cursor-grab active:cursor-grabbing"
      draggable="true"
      data-handoff="pane-grip"
      :aria-label="`Move ${blockName}`"
      @dragstart="onHandleDragStart"
      @dragend="onHandleDragEnd"
      @click.stop="emit('select', path)"
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
.board-grip { opacity: .55; transition: opacity .15s; }
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
