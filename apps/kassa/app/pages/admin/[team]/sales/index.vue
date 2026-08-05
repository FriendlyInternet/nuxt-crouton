<script setup lang="ts">
/**
 * Sales Root — Redirect to Events
 *
 * The sales section is collapsed to a single events page.
 * Any direct visit to /admin/[team]/sales lands on /sales/events.
 *
 * @route /admin/[team]/sales
 */
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const teamParam = computed(() => route.params.team as string)

await navigateTo(`/admin/${teamParam.value}/sales/events`, { replace: true })
</script>

<template>
  <div />
</template>
