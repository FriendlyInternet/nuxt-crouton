<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'can'],
  can: 'media:manage'
})
</script>

<template>
  <UDashboardPanel id="assets-library">
    <UDashboardNavbar :title="$t('assets.admin.media')">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
    </UDashboardNavbar>

    <CroutonAssetsLibrary />
  </UDashboardPanel>
</template>
