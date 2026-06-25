<script setup lang="ts">
/**
 * CroutonLayoutRenderer — renders a layout *data tree* into resizable, nestable
 * panes using reka-ui's Splitter primitives (Sprint 0 #713 → Sprint 1 #704 →
 * runtime min-width enforcement Sprint 3 #706 → collapsible panes #852).
 *
 * - `split` node → a SplitterGroup with one SplitterPanel per OPEN child
 *   (recursing), interleaved with resize handles. Nesting = a group inside a panel.
 * - `leaf` node  → one block, resolved id → component NAME through the
 *   ALLOWLISTED `croutonLayoutBlocks` registry (#704). An unknown id renders a
 *   safe fallback — NEVER an arbitrary component. Per-block config is sanitized
 *   against the block's declared schema before it reaches props.
 *
 * Min-width enforcement (#710): a horizontal pane refuses to shrink a block
 * below its declared `minWidth` — we measure the live group width and convert
 * each block's px floor to the SplitterPanel's `min-size` (%) via
 * `panelMinSizePct`. Splitter primitives are SSR-safe (no <ClientOnly> needed);
 * the floor falls back to the authored `minSize` until the group has measured.
 *
 * Collapsible panes (#852): a child marked `collapsible` can be closed into a
 * compact affordance. The first/reference style is `gutter-tabs` (lifted from
 * sales `EventWorkspace/Shell.vue`): a closed pane leaves the splitter and hangs
 * as a vertical tab in a reserved right gutter (`pe-11`); clicking the tab
 * re-opens it, and an open collapsible pane carries a ✕ to re-collapse. A closed
 * pane occupies no pane width, so min-width/viability is enforced only on the
 * panes actually in the splitter — re-opening one restores its `minWidth` floor.
 * Open-state is read from `node.open` (persisted in the tree) and toggled live;
 * the toggle also emits `openChange(path, open)` so an owner can persist it
 * (`setOpen` → `useCroutonLayoutStore`), the same way `layoutChange` carries
 * resize results.
 */
import { computed, reactive, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import { minWidthResolver, panelMinSizePct } from '../utils/layout-viability'
import type { NodePath } from '../utils/layout-edit'

const props = withDefaults(
  defineProps<{
    node: LayoutNode
    /** This node's path from the renderer root ([] = root) — used for `openChange`. */
    path?: NodePath
  }>(),
  { path: () => [] },
)

const emit = defineEmits<{
  /** Bubbled up on resize so the owner can persist sizes into its tree. */
  layoutChange: [node: LayoutSplit, sizes: number[]]
  /** Bubbled up when a collapsible pane is toggled so the owner can persist `open`. */
  openChange: [path: NodePath, open: boolean]
}>()

const { blocks, resolveComponentName, sanitizeConfig } = useCroutonLayoutBlocks()
const { t } = useT()

// Allowlisted: only ids registered in croutonLayoutBlocks resolve to a component.
const componentName = computed<string | null>(() =>
  props.node.type === 'leaf' ? resolveComponentName(props.node.blockId) : null,
)
const safeConfig = computed<Record<string, unknown>>(() =>
  props.node.type === 'leaf' ? sanitizeConfig(props.node.blockId, props.node.config) : {},
)

// Live width of THIS split's group → converts each child's px min-width floor
// to a percentage min-size for its panel (horizontal splits only).
const groupRef = ref<HTMLElement | null>(null)
const { width: groupWidth } = useElementSize(groupRef)
const minWidthFor = computed(() => minWidthResolver(blocks.value))

// ---- Collapse state (#852) ------------------------------------------------
// Local open overrides keyed by direct-child index, so the read-only renderer
// stays interactive (the demo / paneBlock tree need not be mutable). Seeded
// lazily from each child's persisted `node.open`; a toggle also emits
// `openChange` so a persistence-capable owner can write it back to the tree.
const localOpen = reactive<Record<number, boolean>>({})

function childOpen(child: LayoutNode, i: number): boolean {
  if (!child.collapsible) return true
  return localOpen[i] ?? child.open ?? true
}

function toggle(i: number, open: boolean) {
  localOpen[i] = open
  emit('openChange', [...props.path, i], open)
}

interface ChildSlot { child: LayoutNode, index: number }

const openChildren = computed<ChildSlot[]>(() =>
  props.node.type === 'split'
    ? props.node.children
        .map((child, index) => ({ child, index }))
        .filter(({ child, index }) => childOpen(child, index))
    : [],
)

const collapsedChildren = computed<ChildSlot[]>(() =>
  props.node.type === 'split'
    ? props.node.children
        .map((child, index) => ({ child, index }))
        .filter(({ child, index }) => child.collapsible && !childOpen(child, index))
    : [],
)

// The gutter is reserved whenever at least one vertical tab is hanging.
const hasGutter = computed(() => collapsedChildren.value.length > 0)

function panelMin(child: LayoutNode): number {
  if (props.node.type !== 'split') return 0
  return panelMinSizePct(props.node.direction, child, groupWidth.value, minWidthFor.value)
}

function panelDefault(child: LayoutNode): number {
  return child.defaultSize ?? 100 / Math.max(openChildren.value.length, 1)
}

// reka's @layout emits sizes for the OPEN panels in order; re-align them to the
// full children array (collapsed children keep their last-known size) so a
// consumer's `applySizes` indexes line up with the tree.
function onLayout(sizes: number[]) {
  if (props.node.type !== 'split') return
  let s = 0
  const full = props.node.children.map((child, i) =>
    childOpen(child, i) ? (sizes[s++] ?? child.defaultSize ?? 0) : (child.defaultSize ?? 0),
  )
  emit('layoutChange', props.node, full)
}

// Tab affordance metadata — icon + label come from the collapsed leaf's block.
function tabIcon(child: LayoutNode): string {
  const def = child.type === 'leaf' ? blocks.value[child.blockId] : undefined
  return def?.icon || 'i-lucide-panel-right-open'
}
function tabLabel(child: LayoutNode): string {
  const def = child.type === 'leaf' ? blocks.value[child.blockId] : undefined
  return def?.name ? t(def.name) : 'Panel'
}
</script>

<template>
  <!-- Leaf -->
  <template v-if="node.type === 'leaf'">
    <component
      :is="componentName"
      v-if="componentName"
      v-bind="safeConfig"
      class="h-full w-full overflow-auto"
    />
    <div
      v-else
      class="h-full w-full flex items-center justify-center p-4 text-sm text-error text-center"
    >
      Unknown block:&nbsp;<code>{{ node.blockId }}</code>
    </div>
  </template>

  <!-- Split -->
  <div
    v-else
    class="relative h-full w-full"
    :class="hasGutter ? 'pe-11' : ''"
  >
    <SplitterGroup
      ref="groupRef"
      :direction="node.direction"
      class="h-full w-full"
      @layout="onLayout"
    >
      <template
        v-for="(slot, oi) in openChildren"
        :key="slot.index"
      >
        <SplitterResizeHandle
          v-if="oi > 0"
          class="bg-border hover:bg-primary transition-colors data-[orientation=horizontal]:w-px data-[orientation=vertical]:h-px"
        />
        <SplitterPanel
          :default-size="panelDefault(slot.child)"
          :min-size="panelMin(slot.child)"
          class="relative overflow-hidden"
        >
          <CroutonLayoutRenderer
            :node="slot.child"
            :path="[...path, slot.index]"
            @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
            @open-change="(p: NodePath, o: boolean) => emit('openChange', p, o)"
          />
          <!-- Re-collapse control for an open collapsible pane (gutter-tabs ✕). -->
          <UButton
            v-if="slot.child.collapsible"
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            :aria-label="`Collapse ${tabLabel(slot.child)}`"
            class="absolute top-2 right-2 z-20 bg-elevated/80 backdrop-blur-sm hover:bg-elevated"
            @click="toggle(slot.index, false)"
          />
        </SplitterPanel>
      </template>
    </SplitterGroup>

    <!-- Gutter tabs: each collapsed pane hangs as a vertical tab in the reserved
         right gutter; clicking it re-opens the pane. Mirrors Shell.vue's
         `[writing-mode:vertical-rl]` tab + `rounded-e-md` outer edge. -->
    <div
      v-if="hasGutter"
      class="absolute top-3 right-0 z-10 flex w-11 flex-col items-stretch gap-2"
    >
      <button
        v-for="slot in collapsedChildren"
        :key="slot.index"
        type="button"
        class="flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-e-md cursor-pointer
               border border-l-0 border-default bg-elevated/60 hover:bg-elevated
               text-muted hover:text-highlighted transition-colors"
        :aria-label="tabLabel(slot.child)"
        @click="toggle(slot.index, true)"
      >
        <UIcon :name="tabIcon(slot.child)" class="size-4 shrink-0" />
        <span class="[writing-mode:vertical-rl] text-sm font-medium tracking-wide">
          {{ tabLabel(slot.child) }}
        </span>
      </button>
    </div>
  </div>
</template>
