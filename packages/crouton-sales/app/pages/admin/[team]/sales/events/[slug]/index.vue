<script setup lang="ts">
/**
 * Event Workspace page
 *
 * Renders the SAME adaptive event-workspace block the CMS pages use
 * (SalesBlocksEventWorkspaceRender): desktop = the multi-pane shell inline,
 * mobile = the "Open kassa" launcher + pane-opening buttons. One workspace
 * experience everywhere (#2186) — no separate admin-only version.
 *
 * @route /admin/[team]/sales/events/[slug]
 */
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const eventSlug = computed(() => route.params.slug as string)
</script>

<template>
  <div class="p-6">
    <SalesBlocksEventWorkspaceRender :attrs="{ eventSlug }" />
  </div>
</template>