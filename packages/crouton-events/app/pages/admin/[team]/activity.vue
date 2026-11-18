<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'can'],
  can: 'activity:view'
})
</script>

<template>
  <UDashboardPanel id="events-activity">
    <template #header>
      <UDashboardNavbar :title="$t('events.admin.activity')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <CroutonActivityLog />
    </template>
  </UDashboardPanel>
</template>
