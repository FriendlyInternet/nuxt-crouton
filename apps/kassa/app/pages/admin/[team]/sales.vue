<script setup lang="ts">
/**
 * Fanfare Sales Section Parent Layout
 *
 * Shadows the package sales.vue to remove the top tab navigation.
 * Navigation is handled entirely by the sidebar.
 *
 * @route /admin/[team]/sales
 */
definePageMeta({
  middleware: ['auth'],
  layout: 'admin'
})

const { teamSlug } = useTeamContext()
const { t } = useT()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="t('sales.admin.sectionTitle')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-[96rem] mx-auto w-full">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
