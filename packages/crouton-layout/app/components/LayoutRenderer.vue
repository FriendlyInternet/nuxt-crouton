<script setup lang="ts">
/**
 * CroutonLayoutRenderer — renders a layout *data tree* into resizable, nestable
 * panes using reka-ui's Splitter primitives (Sprint 0 #713 → Sprint 1 #704 →
 * runtime min-width enforcement Sprint 3 #706).
 *
 * - `split` node → a SplitterGroup with one SplitterPanel per child (recursing),
 *   interleaved with resize handles. Nesting = a group inside a panel.
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
 */
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import { minWidthResolver, panelMinSizePct } from '../utils/layout-viability'

const props = defineProps<{ node: LayoutNode }>()

const emit = defineEmits<{
  /** Bubbled up on resize so the owner can persist sizes into its tree. */
  layoutChange: [node: LayoutSplit, sizes: number[]]
}>()

const { blocks, resolveComponentName, sanitizeConfig } = useCroutonLayoutBlocks()

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

function panelMin(child: LayoutNode): number {
  if (props.node.type !== 'split') return 0
  return panelMinSizePct(props.node.direction, child, groupWidth.value, minWidthFor.value)
}

function onLayout(sizes: number[]) {
  if (props.node.type === 'split') emit('layoutChange', props.node, sizes)
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
  <SplitterGroup
    v-else
    ref="groupRef"
    :direction="node.direction"
    class="h-full w-full"
    @layout="onLayout"
  >
    <template
      v-for="(child, i) in node.children"
      :key="i"
    >
      <SplitterResizeHandle
        v-if="i > 0"
        class="bg-border hover:bg-primary transition-colors data-[orientation=horizontal]:w-px data-[orientation=vertical]:h-px"
      />
      <SplitterPanel
        :default-size="child.defaultSize ?? (100 / node.children.length)"
        :min-size="panelMin(child)"
        class="overflow-hidden"
      >
        <CroutonLayoutRenderer
          :node="child"
          @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
        />
      </SplitterPanel>
    </template>
  </SplitterGroup>
</template>
