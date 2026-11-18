<script setup lang="ts">
/**
 * Site Info Page
 *
 * Team favicon and site information settings (contact email, URLs, social links).
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/site-info
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

    <div v-else class="space-y-8">
      <TeamFaviconSettings />
      <USeparator />
      <TeamSiteInfoSettings />
    </div>
  </div>
</template>
