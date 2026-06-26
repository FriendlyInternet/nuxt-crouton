<script setup lang="ts">
/**
 * SpikeBlockNode (spike #903) — a Vue Flow node that renders a layout BLOCK on the
 * flow canvas. Dropped from the drawer, it shows the real block (via the normal
 * read-only renderer as a single leaf) so "drag a collection's block onto the flow"
 * looks like the actual thing, not a placeholder. Vue Flow forwards `data`.
 *
 * No `@vue-flow/core` import (connection handles aren't needed for fork A, and the
 * package isn't a direct POC dep) — it's just a card Vue Flow positions.
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

const props = defineProps<{
  data: { blockId: string, label?: string }
  selected?: boolean
}>()

const node = computed<LayoutNode>(() => ({ type: 'leaf', blockId: props.data.blockId }))
</script>

<template>
  <UCard
    class="spike-block-node w-64 transition-shadow"
    :class="selected ? 'ring-primary shadow-lg' : ''"
    :ui="{ root: 'overflow-hidden', header: 'flex items-center gap-2 bg-elevated/60 px-3 py-1.5 sm:px-3', body: 'h-36 p-0 sm:p-0' }"
  >
    <template #header>
      <UIcon name="i-lucide-box" class="size-3.5 text-primary" />
      <span class="text-xs font-medium">{{ data.label || data.blockId }}</span>
    </template>
    <CroutonLayoutRenderer :node="node" />
  </UCard>
</template>
