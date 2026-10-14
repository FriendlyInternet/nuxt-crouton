<script setup lang="ts">
/**
 * Triage Section Parent Layout
 *
 * Provides horizontal tab navigation for all triage admin pages.
 * Child routes render in the body via <NuxtPage />.
 *
 * @route /admin/[team]/triage
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
      label: t('triage.admin.overview') || 'Overview',
      icon: 'i-lucide-activity',
      to: `/admin/${teamSlug.value}/triage`,
      exact: true
    },
    {
      label: t('triage.admin.discussions') || 'Discussions',
      icon: 'i-lucide-message-square',
      to: `/admin/${teamSlug.value}/triage/discussions`
    },
    {
      label: t('triage.admin.tasks') || 'Tasks',
      icon: 'i-lucide-check-square',
      to: `/admin/${teamSlug.value}/triage/tasks`
    },
    {
      label: t('triage.admin.jobs') || 'Jobs',
      icon: 'i-lucide-activity',
      to: `/admin/${teamSlug.value}/triage/jobs`
    },
    {
      label: t('triage.admin.inbox') || 'Inbox',
      icon: 'i-lucide-inbox',
      to: `/admin/${teamSlug.value}/triage/inbox`
    }
  ]
])
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="t('triage.admin.sectionTitle') || 'Triage'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UNavigationMenu
        :items="tabs"
        orientation="horizontal"
        highlight
        highlight-color="primary"
        class="border-b border-default px-4"
      />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto w-full">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
