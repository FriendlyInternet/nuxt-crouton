<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'team-admin']
})
</script>

<template>
  <UDashboardPanel id="events-activity">
    <UDashboardNavbar :title="$t('events.admin.activity')">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
    </UDashboardNavbar>

    <template #body>
      <CroutonActivityLog />
    </template>
  </UDashboardPanel>
</template>
