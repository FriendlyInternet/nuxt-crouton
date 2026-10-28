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
  <!-- Body carries no padding: pages own their p-4 sm:p-6 gutter so content lines up
       with the top bar, matching CroutonTabsPanel (#2419). -->
  <UDashboardPanel :ui="{ body: 'p-0 sm:p-0 gap-0 sm:gap-0' }">
    <template #header>
      <UDashboardNavbar :title="t('sales.admin.sectionTitle')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-[96rem] w-full">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
