<script setup lang="ts">
// Apps tab: one card per app, the apps with the most waiting to be tested first.
import type { AppCardRow } from '~/utils/dashboard'

defineProps<{ error?: string | null, pending: boolean, cards: AppCardRow[] }>()
</script>

<template>
  <div class="space-y-4 py-4">
    <DashboardLoadState :error="error" :pending="pending" :empty="cards.length ? null : 'No apps found.'" />
    <DashboardAppCard v-for="a in cards" :key="a.app" :row="a" />
  </div>
</template>
