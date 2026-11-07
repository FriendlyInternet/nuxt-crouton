<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface ToTestItem { kind: 'epic' | 'pr', number: number, title: string, url: string, app: string | null, what: string, steps: string[], to: string }
interface Preview { pr: number, title: string, updatedAt: string, url: string }
interface Question { number: number, title: string, url: string }
interface Decision { date: string, epic: number, decision: string, why: string, rejected: string }
interface AppCard {
  app: string | null
  hasSignIn?: boolean
  dir: string | null
  stagingUrl: string | null
  previews: Preview[]
  toTest: ToTestItem[]
  questions: Question[]
  decisions: Decision[]
}

const { data: appsRes, status: appsStatus } = await useFetch<{ data: AppCard[] | null, error: string | null }>('/api/status/apps', { lazy: true })
// The server already orders cards (General last, most to test first).
const cards = computed(() => (appsRes.value?.data ?? []).map(c => ({ card: c, v: toCardView(c) })))

</script>

<template>
  <UContainer class="py-4 sm:py-6">
    <div class="space-y-4">
      <div class="flex justify-end">
        <NuxtLink to="/changelog" class="text-sm text-primary">Changelog →</NuxtLink>
      </div>
      <UAlert v-if="appsRes?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="appsRes.error" />
      <p v-if="appsStatus === 'pending'" class="text-muted">Loading…</p>
      <p v-else-if="!cards.length" class="text-muted">No apps found.</p>

      <StatusAppCard v-for="{ card, v } in cards" :key="card.app ?? 'general'" :card="card" :v="v" />
    </div>
  </UContainer>
</template>
