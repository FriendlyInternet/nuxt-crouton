<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'team-admin']
})

const { t } = useI18n()

// The log exposes refresh()/exportAs() so its actions can live in the navbar
const log = ref<{ refresh: () => unknown, exportAs: (format: 'csv' | 'json') => Promise<void>, exporting: boolean } | null>(null)

const exportItems = computed(() => [[
  { label: t('events.log.exportCsv'), icon: 'i-lucide-file-spreadsheet', onSelect: () => log.value?.exportAs('csv') },
  { label: t('events.log.exportJson'), icon: 'i-lucide-file-json', onSelect: () => log.value?.exportAs('json') }
]])
</script>

<template>
  <UDashboardPanel id="events-activity">
    <template #header>
      <UDashboardNavbar :title="t('events.admin.activity')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :label="t('events.log.refresh')"
            @click="log?.refresh()"
          />
          <UDropdownMenu :items="exportItems">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-download"
              trailing-icon="i-lucide-chevron-down"
              :label="t('events.log.export')"
              :loading="log?.exporting"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <CroutonActivityLog ref="log" />
    </template>
  </UDashboardPanel>
</template>
