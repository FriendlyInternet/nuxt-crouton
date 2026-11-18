<script setup lang="ts">
/**
 * Look and Feel Page
 *
 * Team theme and appearance settings.
 * Favicon + site information live on the sibling Site info tab (site-info.vue).
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/look-and-feel
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
      <TeamThemeSettings />
    </div>
  </div>
</template>
