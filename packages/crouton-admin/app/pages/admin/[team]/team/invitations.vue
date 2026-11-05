<script setup lang="ts">
/**
 * Team Invitations Page
 *
 * View and manage pending team invitations.
 * Uses the TeamInvitations component for the list.
 *
 * @route /admin/[team]/team/invitations
 */
</script>

<template>
  <div class="p-4 sm:p-6">
    <!-- Pending Invitations List -->
    <TeamInvitations :show-team-invitations="true" />
  </div>
</template>
