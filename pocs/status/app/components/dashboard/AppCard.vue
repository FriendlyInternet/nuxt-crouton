<script setup lang="ts">
// One app on the Apps tab: what waits to be tested, its staging link, its open PR previews.
import type { AppCardRow } from '~/utils/dashboard'

defineProps<{ row: AppCardRow }>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold">{{ row.app }}</h2>
        <UBadge v-if="row.toTest.length" color="warning" variant="subtle">{{ row.toTest.length }} to test</UBadge>
      </div>
    </template>
    <div class="space-y-4">
      <div v-if="row.toTest.length" class="space-y-3">
        <p class="text-xs font-semibold uppercase text-muted">To test</p>
        <DashboardAppTodo v-for="i in row.toTest" :key="`${i.kind}-${i.number}`" :app="row.app" :item="i" />
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase text-muted">Staging</p>
        <p v-if="!row.stagingUrl" class="text-sm text-muted">No staging URL configured.</p>
        <template v-else>
          <a :href="row.stagingUrl" target="_blank" rel="noopener" class="block break-all text-sm text-primary">{{ row.stagingUrl }}</a>
          <UButton block icon="i-lucide-log-in" label="Open and sign in" :href="`/api/status/login/${row.app}?key=main`" target="_blank" />
        </template>
      </div>

      <div v-if="row.previews.length" class="space-y-2">
        <p class="text-xs font-semibold uppercase text-muted">Open PR previews</p>
        <DashboardAppPreview v-for="p in row.previews" :key="p.pr" :app="row.app" :preview="p" />
      </div>
    </div>
  </UCard>
</template>
