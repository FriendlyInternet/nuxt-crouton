<script setup lang="ts">
/**
 * Layout-block wrapper: the POS kassa as a placeable pane.
 *
 * Reproduces the `pos` SplitterPanel of EventWorkspace/Shell.vue, but driven
 * from a layout *data tree* (`croutonLayoutBlocks` id `sales-pos`) rendered by
 * CroutonLayoutRenderer instead of the hand-coded splitter — the #711 test
 * ("can the layout engine reproduce a real production surface?").
 *
 * SalesPosPanel resolves the event by slug and loads its session client-side
 * (admin token / helper PIN), so this needs no <Suspense> or loggedIn gate.
 * The renderer passes only the block's declared config (`eventSlug`) through.
 */
const props = defineProps<{
  /** Event slug — the block's only config field (see app.config croutonLayoutBlocks). */
  eventSlug?: string
  /** Team route param; defaults to route.params.team inside SalesPosPanel. */
  teamParam?: string
}>()
</script>

<template>
  <SalesPosPanel
    :event-slug="props.eventSlug || ''"
    :team-param="props.teamParam"
    :show-header="false"
    class="h-full"
  />
</template>
