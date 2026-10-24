<script setup lang="ts">
/**
 * Bookings Section Parent Layout
 *
 * Provides horizontal tab navigation for all booking admin pages.
 * Child routes render in the body via <NuxtPage />.
 *
 * @route /admin/[team]/bookings
 */
definePageMeta({
  middleware: ['auth'],
  layout: 'admin'
})

const { teamSlug } = useTeamContext()
const { t } = useT()

// Tab navigation items
const tabs = computed(() => [
  [
    {
      label: t('bookings.admin.overview'),
      icon: 'i-lucide-calendar',
      to: `/admin/${teamSlug.value}/bookings`,
      exact: true // Only highlight when exactly on /bookings, not child routes
    },
    {
      label: t('bookings.admin.locations'),
      icon: 'i-lucide-map-pin',
      to: `/admin/${teamSlug.value}/bookings/locations`
    },
    {
      label: t('bookings.admin.settings'),
      icon: 'i-lucide-settings',
      to: `/admin/${teamSlug.value}/bookings/settings`
    },
    {
      label: t('bookings.settings.emailTemplates'),
      icon: 'i-lucide-mail',
      to: `/admin/${teamSlug.value}/bookings/email-templates`
    },
    {
      label: t('bookings.settings.emailLogs'),
      icon: 'i-lucide-file-text',
      to: `/admin/${teamSlug.value}/bookings/email-logs`
    }
  ]
])
</script>

<template>
  <!--
    Body carries no padding: each tab page owns its own gutter, so a second
    layer here pushed content past the tab bar (#2369).
  -->
  <UDashboardPanel :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :title="t('bookings.admin.sectionTitle')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UNavigationMenu
        :items="tabs"
        orientation="horizontal"
        highlight
        highlight-color="primary"
        class="border-b border-default px-1.5 sm:px-3.5"
      />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto w-full">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
