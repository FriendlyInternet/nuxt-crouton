<script setup lang="ts">
/**
 * Tasks Page
 *
 * Lists all triage tasks using the collection viewer.
 *
 * @route /admin/[team]/triage/tasks
 */
</script>

<template>
  <div class="h-full">
    <CroutonCollectionViewer
      collection-name="triageTasks"
      default-layout="table"
    />
  </div>
</template>
