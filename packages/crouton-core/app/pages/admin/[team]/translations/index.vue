<script setup lang="ts">
/**
 * Admin Translations Page
 *
 * Dedicated page for managing UI translations with team overrides.
 *
 * @route /admin/[team]/translations
 */
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'team-admin']
})

const { t } = useT()
</script>

<template>
  <UDashboardPanel id="admin-translations">
    <template #header>
      <UDashboardNavbar :title="t('navigation.translations') || 'Translations'">
        <template #leading>
          <UDashboardSidebarCollapse class="hidden lg:flex" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <TranslationsUiList />
    </template>
  </UDashboardPanel>
</template>
