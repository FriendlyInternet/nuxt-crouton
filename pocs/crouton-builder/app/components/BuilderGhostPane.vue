<script setup lang="ts">
/**
 * BuilderGhostPane — the placeholder pane spliced into a layout while an armed
 * pane-drop is held, so the real panes ease apart to open its slot (renderer FLIP).
 * A translucent dashed emerald slab that fills its pane and names the incoming item.
 * Registered as the `__dropghost__` layout block. Carries the `ghost-pane` handoff
 * hook (reproduced verbatim from the POC so the C1 walk runs identically).
 */
const label = inject(BUILDER_GHOST_LABEL_KEY, null)
</script>

<template>
  <div
    data-handoff="ghost-pane"
    class="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-emerald-400 bg-emerald-400/15 p-2 text-center text-emerald-100 shadow-[0_0_16px_3px_rgba(16,185,129,0.4)]"
  >
    <div class="flex flex-col items-center gap-1">
      <UIcon name="i-lucide-plus" class="size-4" />
      <span class="max-w-full truncate text-[10px] font-semibold">{{ (label && label.value) ?? 'Drops here' }}</span>
    </div>
  </div>
</template>
