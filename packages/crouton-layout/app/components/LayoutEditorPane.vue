<script setup lang="ts">
/**
 * CroutonLayoutEditorPane — the recursive *editable* counterpart to
 * CroutonLayoutRenderer (Sprint 3, #706). Same Splitter structure, plus edit
 * chrome: drop zones (drag a palette block onto an edge to split, or center to
 * swap), a per-pane toolbar (configure / remove), and selection highlight. It
 * never resolves an arbitrary component — leaves go through the same allowlisted
 * registry as the read-only renderer.
 *
 * Edits are delegated to the `LayoutEditApi` provided by CroutonLayout (keyed by
 * this pane's `path`), so the tree stays the single source of truth.
 */
import { computed, inject, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { DropEdge } from '../utils/layout-edit'
import { minWidthResolver, panelMinSizePct } from '../utils/layout-viability'
import { LAYOUT_EDIT_KEY, pathKey, type LayoutEditApi } from '../composables/useCroutonLayoutEdit'

const props = defineProps<{ node: LayoutNode, path: number[] }>()

const editor = inject<LayoutEditApi>(LAYOUT_EDIT_KEY)!
const { blocks, resolveComponentName, sanitizeConfig, getBlock } = useCroutonLayoutBlocks()

const componentName = computed<string | null>(() =>
  props.node.type === 'leaf' ? resolveComponentName(props.node.blockId) : null,
)
const safeConfig = computed<Record<string, unknown>>(() =>
  props.node.type === 'leaf' ? sanitizeConfig(props.node.blockId, props.node.config) : {},
)
const def = computed(() => (props.node.type === 'leaf' ? getBlock(props.node.blockId) : undefined))
const selected = computed(() => editor.selectedPath.value === pathKey(props.path))

// Min-width enforcement, same as the read-only renderer.
const groupRef = ref<HTMLElement | null>(null)
const { width: groupWidth } = useElementSize(groupRef)
const minWidthFor = computed(() => minWidthResolver(blocks.value))
function panelMin(child: LayoutNode): number {
  if (props.node.type !== 'split') return 0
  return panelMinSizePct(props.node.direction, child, groupWidth.value, minWidthFor.value)
}

const DROP_MIME = 'application/x-crouton-block'
function allowDrop(e: DragEvent) {
  if (e.dataTransfer?.types.includes(DROP_MIME)) e.preventDefault()
}
function onDrop(e: DragEvent, edge: DropEdge) {
  e.preventDefault()
  e.stopPropagation()
  const blockId = e.dataTransfer?.getData(DROP_MIME)
  if (blockId) editor.drop(props.path, blockId, edge)
}

// Edge drop zones laid out on a 3×3 grid (top/bottom span the row; left/center/
// right fill the middle). Each is a labelled, highlight-on-hover target.
const zones: { edge: DropEdge, area: string, label: string }[] = [
  { edge: 'top', area: 'top', label: '↑' },
  { edge: 'left', area: 'left', label: '←' },
  { edge: 'center', area: 'mid', label: 'replace' },
  { edge: 'right', area: 'right', label: '→' },
  { edge: 'bottom', area: 'bottom', label: '↓' },
]
</script>

<template>
  <!-- Leaf: block preview + edit chrome -->
  <div
    v-if="node.type === 'leaf'"
    data-testid="editor-pane"
    :data-path="path.join('.')"
    :data-block-id="node.blockId"
    class="group/pane relative h-full w-full"
    :class="selected ? 'ring-2 ring-primary ring-inset' : 'ring-1 ring-default/60 ring-inset'"
    @click="editor.select(path)"
  >
    <!-- Preview (non-interactive so drops/toolbar win) -->
    <div class="h-full w-full overflow-auto pointer-events-none select-none">
      <component
        :is="componentName"
        v-if="componentName"
        v-bind="safeConfig"
        class="h-full w-full"
      />
      <div
        v-else
        class="h-full w-full flex items-center justify-center p-4 text-sm text-error text-center"
      >
        Unknown block:&nbsp;<code>{{ node.blockId }}</code>
      </div>
    </div>

    <!-- Pane toolbar -->
    <div
      class="absolute top-1 right-1 z-20 flex items-center gap-1 opacity-0 group-hover/pane:opacity-100 transition-opacity"
      :class="{ 'opacity-100': selected }"
    >
      <span class="px-1.5 py-0.5 rounded bg-elevated/90 text-[10px] font-medium text-muted">
        {{ def?.name || node.blockId }}
      </span>
      <UButton
        size="xs"
        color="neutral"
        variant="solid"
        icon="i-lucide-settings-2"
        :aria-label="`Configure ${def?.name || node.blockId}`"
        @click.stop="editor.select(path)"
      />
      <UButton
        size="xs"
        color="error"
        variant="solid"
        icon="i-lucide-trash-2"
        :aria-label="`Remove ${def?.name || node.blockId}`"
        @click.stop="editor.remove(path)"
      />
    </div>

    <!-- Drop zones (only while dragging from the palette) -->
    <div
      v-show="editor.dragging.value"
      class="layout-dropzones absolute inset-0 z-10 grid gap-0.5 p-0.5"
    >
      <div
        v-for="z in zones"
        :key="z.edge"
        data-testid="drop-zone"
        :data-drop-edge="z.edge"
        :data-pane-path="path.join('.')"
        class="flex items-center justify-center rounded border border-dashed border-primary/40 bg-primary/5 text-[10px] uppercase tracking-wide text-primary/70 hover:bg-primary/25 hover:border-primary transition-colors"
        :style="{ gridArea: z.area }"
        @dragover="allowDrop"
        @drop="onDrop($event, z.edge)"
      >
        {{ z.label }}
      </div>
    </div>
  </div>

  <!-- Split: Splitter group, recursing -->
  <SplitterGroup
    v-else
    ref="groupRef"
    :direction="node.direction"
    class="h-full w-full"
    @layout="(sizes: number[]) => editor.resize(path, sizes)"
  >
    <template
      v-for="(child, i) in node.children"
      :key="i"
    >
      <SplitterResizeHandle
        v-if="i > 0"
        class="bg-border hover:bg-primary transition-colors data-[orientation=horizontal]:w-1 data-[orientation=vertical]:h-1"
      />
      <SplitterPanel
        :default-size="child.defaultSize ?? (100 / node.children.length)"
        :min-size="panelMin(child)"
        class="overflow-hidden"
      >
        <CroutonLayoutEditorPane :node="child" :path="[...path, i]" />
      </SplitterPanel>
    </template>
  </SplitterGroup>
</template>

<style scoped>
/* 3×3 drop-zone grid: top & bottom span the full row; left/replace/right fill
   the middle. Keeps edges large enough to hit without a cursor-position calc. */
.layout-dropzones {
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  grid-template-areas:
    'top top top'
    'left mid right'
    'bottom bottom bottom';
}
</style>
