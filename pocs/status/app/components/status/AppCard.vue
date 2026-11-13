<script setup lang="ts">
// One app on the Apps tab: what waits to be tested, its staging link, its open PR previews.
import type { AppRow, ToTestItem } from '~/utils/status-types'

defineProps<{ app: AppRow, toTest: ToTestItem[] }>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold">{{ app.app }}</h2>
        <UBadge v-if="toTest.length" color="warning" variant="subtle">{{ toTest.length }} to test</UBadge>
      </div>
    </template>
    <div class="space-y-4">
      <div v-if="toTest.length" class="space-y-3">
        <p class="text-xs font-semibold uppercase text-muted">To test</p>
        <StatusAppToTest v-for="i in toTest" :key="`${i.kind}-${i.number}`" :item="i" :app="app.app" />
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase text-muted">Staging</p>
        <p v-if="!app.stagingUrl" class="text-sm text-muted">No staging URL configured.</p>
        <template v-else>
          <a :href="app.stagingUrl" target="_blank" rel="noopener" class="block break-all text-sm text-primary">{{ app.stagingUrl }}</a>
          <UButton block icon="i-lucide-log-in" label="Open and sign in" :href="`/api/status/login/${app.app}?key=main`" target="_blank" />
        </template>
      </div>

      <div v-if="app.previews.length" class="space-y-2">
        <p class="text-xs font-semibold uppercase text-muted">Open PR previews</p>
        <StatusAppPreview v-for="p in app.previews" :key="p.pr" :preview="p" :app="app.app" />
      </div>
    </div>
  </UCard>
</template>
