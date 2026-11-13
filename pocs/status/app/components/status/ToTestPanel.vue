<script setup lang="ts">
// To test tab: items grouped by app, with an app filter.
import type { ToTestItem } from '~/utils/status-types'

const props = defineProps<{ items: ToTestItem[], pending: boolean, error: string | null }>()

const appFilter = ref<string | null>(null)
const apps = computed(() => [...new Set(props.items.map(i => i.app ?? 'general'))].sort())
const groups = computed(() => {
  const by = new Map<string, ToTestItem[]>()
  for (const i of props.items) {
    const key = i.app ?? 'general'
    if (appFilter.value && appFilter.value !== key) continue
    by.set(key, [...(by.get(key) ?? []), i])
  }
  return [...by.entries()].map(([app, list]) => ({ app, list, stagingUrl: list.find(i => i.stagingUrl)?.stagingUrl ?? null }))
})
</script>

<template>
  <div class="space-y-5 py-4">
    <div v-if="apps.length" class="flex flex-wrap gap-2">
      <UButton size="sm" :variant="appFilter === null ? 'solid' : 'outline'" label="All" @click="appFilter = null" />
      <UButton
        v-for="a in apps"
        :key="a"
        size="sm"
        :variant="appFilter === a ? 'solid' : 'outline'"
        :label="a"
        @click="appFilter = a"
      />
    </div>

    <UAlert v-if="error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <p v-if="pending" class="text-muted">Loading…</p>
    <p v-else-if="!groups.length" class="text-muted">Nothing to test yet.</p>

    <section v-for="g in groups" :key="g.app" class="space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-3">
        <h2 class="text-lg font-semibold">{{ g.app }}</h2>
        <a v-if="g.stagingUrl" :href="g.stagingUrl" target="_blank" rel="noopener" class="text-sm text-primary break-all">{{ g.stagingUrl }}</a>
      </div>
      <StatusToTestCard v-for="i in g.list" :key="`${i.kind}-${i.number}`" :item="i" />
    </section>
  </div>
</template>
