<script setup lang="ts">
/**
 * Team Section Parent Layout
 *
 * Provides horizontal tab navigation for all team admin pages.
 * Child routes render in the body via <NuxtPage />.
 *
 * @route /admin/[team]/team
 */
definePageMeta({
  middleware: ['auth', 'team-admin'],
  layout: 'admin'
})

const { teamSlug } = useTeamContext()
const { t } = useT()

// Tab navigation items
const tabs = computed(() => [
  [
    {
      label: t('teams.teamSettings') || 'Settings',
      icon: 'i-lucide-settings',
      to: `/admin/${teamSlug.value}/team/settings`
    },
    {
      label: t('teams.members') || 'Members',
      icon: 'i-lucide-users',
      to: `/admin/${teamSlug.value}/team`,
      exact: true
    },
    {
      label: t('teams.invitations') || 'Invitations',
      icon: 'i-lucide-mail',
      to: `/admin/${teamSlug.value}/team/invitations`
    },
    {
      label: t('teams.lookAndFeel') || 'Look and feel',
      icon: 'i-lucide-palette',
      to: `/admin/${teamSlug.value}/team/look-and-feel`
    },
    {
      label: t('teams.siteInfo.tab') || 'Site info',
      icon: 'i-lucide-info',
      to: `/admin/${teamSlug.value}/team/site-info`
    },
    {
      label: t('teams.domains.title') || 'Domains',
      icon: 'i-lucide-globe',
      to: `/admin/${teamSlug.value}/team/domains`
    },
    {
      label: t('redirects.title') || 'Redirects',
      icon: 'i-lucide-arrow-right-left',
      to: `/admin/${teamSlug.value}/team/redirects`
    },
    {
      label: 'Email Templates',
      icon: 'i-lucide-mail-open',
      to: `/admin/${teamSlug.value}/team/email-templates`
    },
    {
      label: t('emailLogs.title') || 'Email Logs',
      icon: 'i-lucide-mail',
      to: `/admin/${teamSlug.value}/team/email-logs`
    }
  ]
])
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="t('navigation.team') || 'Team'">
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
