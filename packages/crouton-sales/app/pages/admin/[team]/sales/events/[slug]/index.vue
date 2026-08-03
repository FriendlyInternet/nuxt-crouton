<script setup lang="ts">
/**
 * Event Workspace page
 *
 * Thin wrapper around <SalesEventWorkspaceShell />. The shell owns the header,
 * panes and data fetching; this page just supplies the route params.
 *
 * @route /admin/[team]/sales/events/[slug]
 */
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const eventSlug = computed(() => route.params.slug as string)
</script>

<template>
  <div class="p-6">
    <SalesEventWorkspaceShell :event-slug="eventSlug" />
  </div>
</template>