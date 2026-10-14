<script setup lang="ts">
/**
 * Discussions Page
 *
 * Lists all triage discussions using the collection viewer.
 *
 * @route /admin/[team]/triage/discussions
 */
</script>

<template>
  <div class="h-full">
    <CroutonCollectionViewer
      collection-name="triageDiscussions"
      default-layout="table"
    />
  </div>
</template>
