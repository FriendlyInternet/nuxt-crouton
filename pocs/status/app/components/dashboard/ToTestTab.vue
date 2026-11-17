<script setup lang="ts">
// To test tab: app filter, then each app's items (with its staging link).
// `filter` lives on the page so it survives switching tabs.
import type { ToTestGroup } from '~/utils/dashboard'

defineProps<{ error?: string | null, pending: boolean, apps: string[], groups: ToTestGroup[] }>()
const filter = defineModel<string | null>('filter', { default: null })
</script>

<template>
  <div class="space-y-5 py-4">
    <DashboardChipFilter v-if="apps.length" v-model="filter" :options="apps" />

    <DashboardLoadState :error="error" :pending="pending" :empty="groups.length ? null : 'Nothing to test yet.'" />

    <section v-for="g in groups" :key="g.app" class="space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-3">
        <h2 class="text-lg font-semibold">{{ g.app }}</h2>
        <a v-if="g.stagingUrl" :href="g.stagingUrl" target="_blank" rel="noopener" class="text-sm text-primary break-all">{{ g.stagingUrl }}</a>
      </div>
      <DashboardToTestCard v-for="i in g.list" :key="`${i.kind}-${i.number}`" :item="i" />
    </section>
  </div>
</template>
