<script setup lang="ts">
/**
 * Team Redirects Page
 *
 * Manage URL redirects for the team.
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/redirects
 */
definePageMeta({
  middleware: ['auth', 'can'],
  can: 'site:manage'
})

const canManage = useCan('site:manage')
</script>

<template>
  <div class="p-4 sm:p-6">
    <TeamAccessRestricted v-if="!canManage" />

    <!-- Redirects -->
    <CroutonRedirectsList v-else />
  </div>
</template>