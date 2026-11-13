<script setup lang="ts">
// The four-tab page (Apps, To test, Decisions, Changelog). Each tab is its own component.
import type { ToTestItem } from '~/utils/status-types'

definePageMeta({ middleware: 'auth' })

const tabs = [
  { label: 'Apps', slot: 'apps', icon: 'i-lucide-layout-grid' },
  { label: 'To test', slot: 'to-test', icon: 'i-lucide-flask-conical' },
  { label: 'Decisions', slot: 'decisions', icon: 'i-lucide-scale' },
  { label: 'Changelog', slot: 'changelog', icon: 'i-lucide-list' }
]

// Both the Apps and To test tabs read the to-test list, so it is fetched once here.
const { data: totest, status: totestStatus } = await useFetch<{ data: ToTestItem[] | null, error: string | null }>('/api/status/totest', { lazy: true })
const items = computed(() => totest.value?.data ?? [])
</script>

<template>
  <UContainer class="py-4 sm:py-6">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left" label="Inbox" class="mb-2" />
    <UTabs :items="tabs" class="w-full">
      <template #apps>
        <StatusAppsPanel :items="items" />
      </template>
      <template #to-test>
        <StatusToTestPanel :items="items" :pending="totestStatus === 'pending'" :error="totest?.error ?? null" />
      </template>
      <template #decisions>
        <StatusDecisionsPanel />
      </template>
      <template #changelog>
        <StatusChangelogPanel />
      </template>
    </UTabs>
  </UContainer>
</template>
