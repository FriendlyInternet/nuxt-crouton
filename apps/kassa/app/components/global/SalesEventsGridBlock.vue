<script setup lang="ts">
/**
 * SalesEventsGridBlock — kassa's events card grid as a placeable layout block (#2532).
 *
 * In `components/global/` on purpose: the renderer mounts a block by its registry
 * `component` NAME at runtime, which only resolves for globally registered components.
 *
 * Registered in `croutonLayoutBlocks` so the events page can be arranged with the
 * layout engine: next to a list, stacked on a phone, hidden at a width. App-owned —
 * the registry is the extension point, no package change. The data-bound grid is
 * `SalesEventsGridData` behind `<Suspense>` (a block mounts outside a page's boundary).
 */
</script>

<template>
  <!-- Sizes to its own pane (block-authoring rule): the card grid steps up with the
       pane's width, not the viewport's. -->
  <div class="@container p-4">
    <Suspense>
      <SalesEventsGridData />
      <template #fallback>
        <div class="flex justify-center p-12">
          <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
        </div>
      </template>
    </Suspense>
  </div>
</template>
