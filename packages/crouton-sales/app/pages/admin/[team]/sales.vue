<script setup lang="ts">
/**
 * Sales (POS) Section Parent Layout
 *
 * Tab navigation for all sales admin pages.
 * Child routes render via <NuxtPage />.
 *
 * @route /admin/[team]/sales
 */
definePageMeta({
  middleware: ['auth'],
  layout: 'admin'
})

const { teamSlug } = useTeamContext()
const { t } = useT()

const tabs = computed(() => [
  [
    {
      label: t('sales.admin.overview'),
      icon: 'i-lucide-shopping-cart',
      to: `/admin/${teamSlug.value}/sales`,
      exact: true
    },
    {
      label: t('sales.sidebar.events'),
      icon: 'i-lucide-calendar',
      to: `/admin/${teamSlug.value}/sales/events`
    },
    {
      label: t('sales.sidebar.products'),
      icon: 'i-lucide-package',
      to: `/admin/${teamSlug.value}/sales/products`
    },
    {
      label: t('sales.sidebar.categories'),
      icon: 'i-lucide-folder',
      to: `/admin/${teamSlug.value}/sales/categories`
    },
    {
      label: t('sales.orders.title'),
      icon: 'i-lucide-receipt',
      to: `/admin/${teamSlug.value}/sales/orders`
    },
    {
      label: t('sales.sidebar.locations'),
      icon: 'i-lucide-map-pin',
      to: `/admin/${teamSlug.value}/sales/locations`
    },
    {
      label: t('sales.sidebar.printers'),
      icon: 'i-lucide-printer',
      to: `/admin/${teamSlug.value}/sales/printers`
    },
    {
      label: t('sales.sidebar.helpers'),
      icon: 'i-lucide-users',
      to: `/admin/${teamSlug.value}/sales/helpers`
    },
    {
      label: t('sales.sidebar.clients'),
      icon: 'i-lucide-user',
      to: `/admin/${teamSlug.value}/sales/clients`
    }
  ]
])
</script>

<template>
  <CroutonTabsPanel
    :title="t('sales.admin.sectionTitle')"
    :tabs="tabs"
    max-width="max-w-6xl"
  >
    <NuxtPage />
  </CroutonTabsPanel>
</template>
