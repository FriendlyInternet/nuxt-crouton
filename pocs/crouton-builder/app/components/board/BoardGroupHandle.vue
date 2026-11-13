<script setup lang="ts">
/**
 * BoardGroupHandle (#3906) — a group's own handle on the board: hold briefly, then
 * drag the whole group onto another pane; tap to open the group's sheet (Ungroup).
 * Its own component so BoardTree doesn't import `~/utils/board-drag` (that module
 * uses the auto-imported `ref` at load).
 */
import type { NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import { useBoardDrag } from '~/utils/board-drag'

const props = defineProps<{
  /** Drawn only for a framed group (more than one block showing at this width). */
  show: boolean
  path: NodePath
  label?: string
  selected: boolean
}>()
const emit = defineEmits<{ select: [at: NodePath] }>()

const { arm, consumeClick } = useBoardDrag()
const name = computed(() => props.label ?? 'Group')

function onDown(e: PointerEvent) {
  arm(e, { kind: 'pane', path: props.path, label: name.value }, { holdMs: 150 })
}
</script>

<template>
  <button
    v-if="show"
    type="button"
    class="board-group-grip absolute left-1 top-1 z-10 flex items-center gap-1 rounded-md bg-elevated/90 px-1.5 py-1 text-[11px] shadow-sm backdrop-blur touch-none select-none cursor-grab active:cursor-grabbing"
    :class="selected ? 'text-primary' : 'text-muted'"
    data-handoff="group-grip"
    aria-label="Move group"
    @pointerdown="onDown"
    @click.stop="consumeClick() || emit('select', path)"
  >
    <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
    <span class="max-w-28 truncate">{{ name }}</span>
  </button>
</template>

<style scoped>
.board-group-grip { -webkit-touch-callout: none; }
</style>
