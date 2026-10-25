<script setup lang="ts">
/**
 * HiddenBlocks (#2418 / #2457) — the triggers for blocks hidden at this width,
 * and the overlay that opens one. Shared by the builder board and the served
 * page, so what you design is what the page does.
 *
 * - An edge-placed block draws a small button on its edge of the screen.
 * - A nav-placed block is rendered by the Top bar / Bottom nav blocks (they inject
 *   `BOARD_HIDDEN_KEY`); the host `provide`s it and calls `open` from there.
 * - `open(blockId)` shows the block as its recipe says: slideover from its edge,
 *   bottom sheet, modal, or full page.
 */
import { collapsePlacement, collapseReveal, type HiddenItem } from '~/utils/board-hidden'

const props = defineProps<{ items: HiddenItem[] }>()

const edgeItems = computed(() => props.items.filter(i => collapsePlacement(i.recipe) === 'edge'))
const revealing = ref<HiddenItem | null>(null)
const revealKind = computed(() => (revealing.value ? collapseReveal(revealing.value.recipe) : null))
const revealSide = computed(() => {
  const e = revealing.value?.recipe.edge ?? 'right'
  return e === 'left' || e === 'right' ? e : 'bottom'
})

function open(key: string) {
  revealing.value = props.items.find(i => i.key === key) ?? null
}
function close() {
  revealing.value = null
}
defineExpose({ open })
</script>

<template>
  <!-- Edge triggers -->
  <div
    v-for="item in edgeItems"
    :key="item.key"
    class="edge-trigger pointer-events-auto fixed z-30"
    :data-edge="item.recipe.edge"
  >
    <UButton
      :icon="item.icon"
      :label="item.recipe.affordance === 'dot' ? undefined : item.label"
      size="xs"
      color="neutral"
      variant="solid"
      :data-edge-trigger="item.key"
      @click="open(item.key)"
    />
  </div>

  <!-- The hidden block, opened the way its recipe says -->
  <USlideover v-if="revealKind === 'slideover'" :open="!!revealing" :side="revealSide" :title="revealing?.label" @update:open="v => { if (!v) close() }">
    <template #body><CroutonLayoutRenderer v-if="revealing" :node="revealing.leaf" :interactive="false" /></template>
  </USlideover>
  <UDrawer v-else-if="revealKind === 'sheet'" :open="!!revealing" :title="revealing?.label" @update:open="v => { if (!v) close() }">
    <template #body><div class="max-h-[70dvh] overflow-auto"><CroutonLayoutRenderer v-if="revealing" :node="revealing.leaf" :interactive="false" /></div></template>
  </UDrawer>
  <UModal v-else-if="revealKind === 'modal' || revealKind === 'page'" :open="!!revealing" :title="revealing?.label" :fullscreen="revealKind === 'page'" @update:open="v => { if (!v) close() }">
    <template #body><CroutonLayoutRenderer v-if="revealing" :node="revealing.leaf" :interactive="false" /></template>
  </UModal>
</template>

<style scoped>
.edge-trigger[data-edge='right'] { right: 8px; top: 50%; transform: translateY(-50%); }
.edge-trigger[data-edge='left'] { left: 8px; top: 50%; transform: translateY(-50%); }
.edge-trigger[data-edge='top'] { top: 8px; left: 50%; transform: translateX(-50%); }
.edge-trigger[data-edge='bottom'] { bottom: 16px; left: 50%; transform: translateX(-50%); }
</style>
