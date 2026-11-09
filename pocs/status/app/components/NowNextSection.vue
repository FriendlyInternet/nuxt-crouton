<script setup lang="ts">
// Now / Next / Waiting for you — read live from GitHub via /api/status/now (no state of its own).
interface Row { number: number, kind?: 'pr' | 'issue', title: string, url: string, step?: string, reason?: string }
interface NowRes { data: { now: Row[], next: Row[], waiting: Row[] } | null, error: string | null }

const { data: res, status } = await useFetch<NowRes>('/api/status/now', { lazy: true })
const sections = computed(() => [
  { key: 'waiting', label: 'Waiting for you', icon: 'i-lucide-hand', rows: res.value?.data?.waiting ?? [] },
  { key: 'now', label: 'Now', icon: 'i-lucide-hammer', rows: res.value?.data?.now ?? [] },
  { key: 'next', label: 'Next', icon: 'i-lucide-list-ordered', rows: res.value?.data?.next ?? [] }
])
</script>

<template>
  <div class="space-y-4">
    <UAlert v-if="res?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="res.error" />
    <p v-if="status === 'pending'" class="text-muted">Loading pipeline…</p>
    <section v-for="s in sections" :key="s.key" class="space-y-2">
      <p class="flex items-center gap-1 text-xs font-semibold uppercase text-muted">
        <UIcon :name="s.icon" /> {{ s.label }} ({{ s.rows.length }})
      </p>
      <p v-if="!s.rows.length && status !== 'pending'" class="text-sm text-muted">Nothing.</p>
      <div v-for="r in s.rows" :key="`${s.key}-${r.number}`" class="space-y-2 rounded-lg border border-default p-3">
        <div class="flex items-start gap-2">
          <span class="flex-1 text-sm font-medium">{{ r.title }}</span>
          <a :href="r.url" target="_blank" rel="noopener" class="text-sm text-primary">#{{ r.number }}</a>
        </div>
        <p v-if="r.step" class="text-xs text-muted">{{ r.step }}</p>
        <p v-if="r.reason" class="text-sm">{{ r.reason }}</p>
        <ReplyButtons v-if="s.key === 'waiting'" :kind="r.kind ?? 'issue'" :number="r.number" />
      </div>
    </section>
  </div>
</template>
