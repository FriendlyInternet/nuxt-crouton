<script setup lang="ts">
// The dashboard: Apps · To test · Decisions · Changelog. The page fetches and owns the filter
// state (so it survives switching tabs); each tab is its own component in components/dashboard/.
import type { AppRow, ChangelogRow, Decision, OpenQuestion, ToTestGroup, ToTestItem } from '~/utils/dashboard'

definePageMeta({ middleware: 'auth' })

const tabs = [
  { label: 'Apps', slot: 'apps', icon: 'i-lucide-layout-grid' },
  { label: 'To test', slot: 'to-test', icon: 'i-lucide-flask-conical' },
  { label: 'Decisions', slot: 'decisions', icon: 'i-lucide-scale' },
  { label: 'Changelog', slot: 'changelog', icon: 'i-lucide-list' }
]

const { data: totest, status: totestStatus } = await useFetch<{ data: ToTestItem[] | null, error: string | null }>('/api/status/totest', { lazy: true })
const { data: decisionsRes, status: decisionsStatus } = await useFetch<{ data: { decisions: Decision[], openQuestions: OpenQuestion[] } | null, error: string | null }>('/api/status/decisions', { lazy: true })
const { data: changelogRes, status: changelogStatus } = await useFetch<{ data: ChangelogRow[] | null, error: string | null }>('/api/status/changelog', { lazy: true })

// --- Apps ---
const { data: appsRes, status: appsStatus } = await useFetch<{ data: AppRow[] | null, error: string | null }>('/api/status/apps', { lazy: true })
const appCards = computed(() => {
  const todo = (app: string) => items.value.filter(i => i.app === app)
  return (appsRes.value?.data ?? [])
    .map(a => ({ ...a, toTest: todo(a.app) }))
    .sort((a, b) => b.toTest.length - a.toTest.length || a.app.localeCompare(b.app))
})

// --- To test ---
const appFilter = ref<string | null>(null)
const items = computed(() => totest.value?.data ?? [])
const apps = computed(() => [...new Set(items.value.map(i => i.app ?? 'general'))].sort())
const groups = computed<ToTestGroup[]>(() => {
  const by = new Map<string, ToTestItem[]>()
  for (const i of items.value) {
    const key = i.app ?? 'general'
    if (appFilter.value && appFilter.value !== key) continue
    by.set(key, [...(by.get(key) ?? []), i])
  }
  return [...by.entries()].map(([app, list]) => ({ app, list, stagingUrl: list.find(i => i.stagingUrl)?.stagingUrl ?? null }))
})

// --- Decisions ---
const decisions = computed(() => decisionsRes.value?.data?.decisions ?? [])
const openQuestions = computed(() => decisionsRes.value?.data?.openQuestions ?? [])
const expanded = ref<string | null>(null)

// --- Changelog ---
const search = ref('')
const areaFilter = ref<string | null>(null)
const rows = computed(() => changelogRes.value?.data ?? [])
const areas = computed(() => [...new Set(rows.value.map(r => r.area))].sort())
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r =>
    (!areaFilter.value || r.area === areaFilter.value)
    && (!q || r.title.toLowerCase().includes(q) || r.area.toLowerCase().includes(q))
  )
})
</script>

<template>
  <UContainer class="py-4 sm:py-6">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left" label="Inbox" class="mb-2" />
    <UTabs :items="tabs" class="w-full">
      <template #apps>
        <DashboardAppsTab :error="appsRes?.error" :pending="appsStatus === 'pending'" :cards="appCards" />
      </template>
      <template #to-test>
        <DashboardToTestTab v-model:filter="appFilter" :error="totest?.error" :pending="totestStatus === 'pending'" :apps="apps" :groups="groups" />
      </template>
      <template #decisions>
        <DashboardDecisionsTab v-model:expanded="expanded" :error="decisionsRes?.error" :pending="decisionsStatus === 'pending'" :decisions="decisions" :open-questions="openQuestions" />
      </template>
      <template #changelog>
        <DashboardChangelogTab v-model:search="search" v-model:area="areaFilter" :error="changelogRes?.error" :pending="changelogStatus === 'pending'" :areas="areas" :rows="filteredRows" />
      </template>
    </UTabs>
  </UContainer>
</template>
