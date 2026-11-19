<script setup lang="ts">
// Changelog tab: search box + area filter over the merged changes.
// `search` and `area` live on the page so they survive switching tabs.
import type { ChangelogRow } from '~/utils/dashboard'

defineProps<{ error?: string | null, pending: boolean, areas: string[], rows: ChangelogRow[] }>()
const search = defineModel<string>('search', { default: '' })
const area = defineModel<string | null>('area', { default: null })
</script>

<template>
  <div class="space-y-4 py-4">
    <UInput v-model="search" icon="i-lucide-search" placeholder="Search changes" class="w-full" aria-label="Search changes" />
    <DashboardChipFilter v-if="areas.length" v-model="area" :options="areas" />

    <DashboardLoadState :error="error" :pending="pending" :empty="rows.length ? null : 'No changes yet.'" />

    <ul v-if="rows.length" class="divide-y divide-default rounded-lg border border-default">
      <li v-for="r in rows" :key="r.number" class="flex flex-wrap items-start gap-x-3 gap-y-1 p-3">
        <span class="text-xs text-muted">{{ r.date }}</span>
        <UBadge variant="subtle" color="neutral">{{ r.area }}</UBadge>
        <span class="basis-full text-sm sm:basis-0 sm:flex-1">{{ r.title }}</span>
        <a :href="r.url" target="_blank" rel="noopener" class="text-sm text-primary">#{{ r.number }}</a>
      </li>
    </ul>
  </div>
</template>
