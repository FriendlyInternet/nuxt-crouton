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

const { t } = useT()

// Same list as the admin side menu; only pages you can open (#4105, #4220)
const pages = useTeamAdminPages()
const tabs = computed(() => [toTabItems(pages.value, t)])
</script>

<template>
  <CroutonTabsPanel
    :title="t('navigation.team') || 'Team'"
    :tabs="tabs"
  >
    <NuxtPage />
  </CroutonTabsPanel>
</template>
