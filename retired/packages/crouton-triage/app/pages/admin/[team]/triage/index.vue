<script setup lang="ts">
/**
 * Triage Overview Page
 *
 * Main dashboard showing the triage pipeline, activity feed, and config slideovers.
 * Uses the CroutonTriagePanel component.
 *
 * @route /admin/[team]/triage
 */
</script>

<template>
  <div class="h-full p-4">
    <CroutonTriagePanel
      title=""
      empty-message="No activity yet. Connect a source to get started."
    />
  </div>
</template>
