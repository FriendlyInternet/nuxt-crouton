<script setup lang="ts">
// Apps tab: one card per app, the ones with the most to test first.
import type { AppRow, ToTestItem } from '~/utils/status-types'

const props = defineProps<{ items: ToTestItem[] }>()

const { data: appsRes, status: appsStatus } = useFetch<{ data: AppRow[] | null, error: string | null }>('/api/status/apps', { lazy: true })
const appCards = computed(() => {
  const todo = (app: string) => props.items.filter(i => i.app === app)
  return (appsRes.value?.data ?? [])
    .map(a => ({ ...a, toTest: todo(a.app) }))
    .sort((a, b) => b.toTest.length - a.toTest.length || a.app.localeCompare(b.app))
})
</script>

<template>
  <div class="space-y-4 py-4">
    <UAlert v-if="appsRes?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="appsRes.error" />
    <p v-if="appsStatus === 'pending'" class="text-muted">Loading…</p>
    <p v-else-if="!appCards.length" class="text-muted">No apps found.</p>
    <StatusAppCard v-for="a in appCards" :key="a.app" :app="a" :to-test="a.toTest" />
  </div>
</template>
