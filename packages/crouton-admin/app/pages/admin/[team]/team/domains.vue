<script setup lang="ts">
/**
 * Domains Page
 *
 * Custom domain management and public site settings.
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/domains
 */
definePageMeta({
  middleware: ['auth', 'can'],
  can: 'team:domains'
})

const canManage = useCan('team:domains')
</script>

<template>
  <div class="p-4 sm:p-6">
    <TeamAccessRestricted v-if="!canManage" />

    <TeamDomainSettings v-else />
  </div>
</template>
