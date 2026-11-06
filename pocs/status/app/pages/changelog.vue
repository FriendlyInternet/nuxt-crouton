<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface ChangelogRow { date: string, number: number, title: string, area: string, url: string }

const { data: changelogRes, status: changelogStatus } = await useFetch<{ data: ChangelogRow[] | null, error: string | null }>('/api/status/changelog', { lazy: true })

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
    <div class="space-y-4">
      <NuxtLink to="/" class="text-sm text-primary">← All apps</NuxtLink>
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search changes" class="w-full" aria-label="Search changes" />
      <div v-if="areas.length" class="flex flex-wrap gap-2">
        <UButton size="sm" :variant="areaFilter === null ? 'solid' : 'outline'" label="All" @click="areaFilter = null" />
        <UButton
          v-for="a in areas"
          :key="a"
          size="sm"
          :variant="areaFilter === a ? 'solid' : 'outline'"
          :label="a"
          @click="areaFilter = a"
        />
      </div>

      <UAlert v-if="changelogRes?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="changelogRes.error" />
      <p v-if="changelogStatus === 'pending'" class="text-muted">Loading…</p>
      <p v-else-if="!filteredRows.length" class="text-muted">No changes yet.</p>

      <ul v-if="filteredRows.length" class="divide-y divide-default rounded-lg border border-default">
        <li v-for="r in filteredRows" :key="r.number" class="flex flex-wrap items-start gap-x-3 gap-y-1 p-3">
          <span class="text-xs text-muted">{{ r.date }}</span>
          <UBadge variant="subtle" color="neutral">{{ r.area }}</UBadge>
          <span class="basis-full text-sm sm:basis-0 sm:flex-1">{{ r.title }}</span>
          <a :href="r.url" target="_blank" rel="noopener" class="text-sm text-primary">#{{ r.number }}</a>
        </li>
      </ul>
    </div>
  </UContainer>
</template>
