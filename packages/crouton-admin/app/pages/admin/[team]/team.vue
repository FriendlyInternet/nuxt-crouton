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
  middleware: ['auth', 'can'],
  can: 'admin:access',
  layout: 'admin'
})

const { teamSlug } = useTeamContext()
const { t } = useT()

// Each tab shows only when its page would open (#4105)
const canTeam = useCan('team:manage')
const canSite = useCan('site:manage')
const canDomains = useCan('team:domains')

// Tab navigation items
const tabs = computed(() => [
  [
    {
      label: t('teams.teamSettings') || 'Settings',
      icon: 'i-lucide-settings',
      to: `/admin/${teamSlug.value}/team/settings`,
      show: canTeam.value
    },
    {
      label: t('teams.members') || 'Members',
      icon: 'i-lucide-users',
      to: `/admin/${teamSlug.value}/team`,
      exact: true,
      show: canTeam.value
    },
    {
      label: t('teams.invitations') || 'Invitations',
      icon: 'i-lucide-mail',
      to: `/admin/${teamSlug.value}/team/invitations`,
      show: canTeam.value
    },
    {
      label: t('teams.lookAndFeel') || 'Look and feel',
      icon: 'i-lucide-palette',
      to: `/admin/${teamSlug.value}/team/look-and-feel`,
      show: canSite.value
    },
    {
      label: t('teams.siteInfo.tab') || 'Site info',
      icon: 'i-lucide-info',
      to: `/admin/${teamSlug.value}/team/site-info`,
      show: canSite.value
    },
    {
      label: t('teams.domains.title') || 'Domains',
      icon: 'i-lucide-globe',
      to: `/admin/${teamSlug.value}/team/domains`,
      show: canDomains.value
    },
    {
      label: t('redirects.title') || 'Redirects',
      icon: 'i-lucide-arrow-right-left',
      to: `/admin/${teamSlug.value}/team/redirects`,
      show: canSite.value
    },
    {
      label: t('emailTemplates.title'),
      icon: 'i-lucide-mail-open',
      to: `/admin/${teamSlug.value}/team/email-templates`,
      show: canTeam.value
    },
    {
      label: t('emailLogs.title') || 'Email Logs',
      icon: 'i-lucide-mail',
      to: `/admin/${teamSlug.value}/team/email-logs`,
      show: canTeam.value
    }
  ].filter(tab => tab.show).map(({ show: _show, ...tab }) => tab)
])
</script>

<template>
  <CroutonTabsPanel
    :title="t('navigation.team') || 'Team'"
    :tabs="tabs"
  >
    <NuxtPage />
  </CroutonTabsPanel>
</template>
