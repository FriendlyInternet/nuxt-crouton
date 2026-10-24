<script setup lang="ts">
/**
 * BuilderSpacer — a real, snappable layout primitive that holds empty space.
 * Faint dashed hint in the builder; snaps/reorders/resizes like any block to push
 * neighbours around or hold a gap. Small `minWidth` (40) so it can be a thin
 * gutter. App-owned; resolved by name via `<component :is>`.
 */
</script>

<template>
  <div
    class="flex h-full min-h-8 w-full items-center justify-center rounded-md border border-dashed border-default/60 text-muted/50"
  >
    <UIcon name="i-lucide-space" class="size-4" />
  </div>
</template>
