<script setup lang="ts">
/**
 * Team Email Logs Page
 *
 * Shows auth email log history for the current team.
 *
 * @route /admin/[team]/team/email-logs
 */
definePageMeta({
  middleware: ['auth', 'team-admin']
})
</script>

<template>
  <div class="p-4 sm:p-6">
    <AdminEmailLogs />
  </div>
</template>
