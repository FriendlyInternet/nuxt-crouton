<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface ToTestItem {
  kind: 'epic' | 'pr'
  number: number
  title: string
  url: string
  app: string | null
  what: string
  steps: string[]
  stagingUrl: string | null
  mergedAt?: string | null
}
interface Decision { date: string, epic: number, decision: string, why: string, rejected: string }
interface OpenQuestion { number: number, title: string, url: string }
interface ChangelogRow { date: string, number: number, title: string, area: string, url: string }

const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'

const tabs = [
  { label: 'To test', slot: 'to-test', icon: 'i-lucide-flask-conical' },
  { label: 'Decisions', slot: 'decisions', icon: 'i-lucide-scale' },
  { label: 'Changelog', slot: 'changelog', icon: 'i-lucide-list' }
]

const { data: totest, status: totestStatus } = await useFetch<{ data: ToTestItem[] | null, error: string | null }>('/api/status/totest', { lazy: true })
const { data: decisionsRes, status: decisionsStatus } = await useFetch<{ data: { decisions: Decision[], openQuestions: OpenQuestion[] } | null, error: string | null }>('/api/status/decisions', { lazy: true })
const { data: changelogRes, status: changelogStatus } = await useFetch<{ data: ChangelogRow[] | null, error: string | null }>('/api/status/changelog', { lazy: true })

// --- To test ---
const appFilter = ref<string | null>(null)
const items = computed(() => totest.value?.data ?? [])
const apps = computed(() => [...new Set(items.value.map(i => i.app ?? 'general'))].sort())
const groups = computed(() => {
  const by = new Map<string, ToTestItem[]>()
  for (const i of items.value) {
    const key = i.app ?? 'general'
    if (appFilter.value && appFilter.value !== key) continue
    by.set(key, [...(by.get(key) ?? []), i])
  }
  return [...by.entries()].map(([app, list]) => ({ app, list, stagingUrl: list.find(i => i.stagingUrl)?.stagingUrl ?? null }))
})

// --- Decisions ---
const decisions = computed(() => decisionsRes.value?.data?.decisions ?? [])
const openQuestions = computed(() => decisionsRes.value?.data?.openQuestions ?? [])
const expanded = ref<string | null>(null)
const rowKey = (d: Decision, idx: number) => `${d.epic}-${idx}`

// --- Changelog ---
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

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
</script>

<template>
  <UContainer class="py-4 sm:py-6">
    <UTabs :items="tabs" class="w-full">
      <!-- To test -->
      <template #to-test>
        <div class="space-y-5 py-4">
          <div v-if="apps.length" class="flex flex-wrap gap-2">
            <UButton
              size="sm"
              :variant="appFilter === null ? 'solid' : 'outline'"
              label="All"
              @click="appFilter = null"
            />
            <UButton
              v-for="a in apps"
              :key="a"
              size="sm"
              :variant="appFilter === a ? 'solid' : 'outline'"
              :label="a"
              @click="appFilter = a"
            />
          </div>

          <UAlert v-if="totest?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="totest.error" />
          <p v-if="totestStatus === 'pending'" class="text-muted">Loading…</p>
          <p v-else-if="!groups.length" class="text-muted">Nothing to test yet.</p>

          <section v-for="g in groups" :key="g.app" class="space-y-3">
            <div class="flex flex-wrap items-baseline gap-x-3">
              <h2 class="text-lg font-semibold">{{ g.app }}</h2>
              <a v-if="g.stagingUrl" :href="g.stagingUrl" target="_blank" rel="noopener" class="text-sm text-primary break-all">{{ g.stagingUrl }}</a>
            </div>
            <UCard v-for="i in g.list" :key="`${i.kind}-${i.number}`">
              <div class="space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge :color="i.kind === 'epic' ? 'warning' : 'success'" variant="subtle">
                    {{ i.kind === 'epic' ? 'Waiting for you' : 'Merged' }}
                  </UBadge>
                  <span v-if="i.mergedAt" class="text-xs text-muted">{{ day(i.mergedAt) }}</span>
                  <a :href="i.url" target="_blank" rel="noopener" class="ml-auto text-sm text-primary">#{{ i.number }}</a>
                </div>
                <h3 class="font-medium">{{ i.title }}</h3>
                <div v-if="i.what">
                  <p class="text-xs font-semibold uppercase text-muted">What changed</p>
                  <p class="text-sm">{{ i.what }}</p>
                </div>
                <div v-if="i.steps.length">
                  <p class="text-xs font-semibold uppercase text-muted">How to check</p>
                  <ol class="list-decimal space-y-1 pl-5 text-sm">
                    <li v-for="(s, n) in i.steps" :key="n">{{ s }}</li>
                  </ol>
                </div>
                <UButton
                  v-if="i.app"
                  block
                  size="lg"
                  icon="i-lucide-log-in"
                  label="Open and sign in"
                  :href="loginHref(i)"
                  target="_blank"
                />
              </div>
            </UCard>
          </section>
        </div>
      </template>

      <!-- Decisions -->
      <template #decisions>
        <div class="space-y-5 py-4">
          <UAlert v-if="decisionsRes?.error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="decisionsRes.error" />
          <p v-if="decisionsStatus === 'pending'" class="text-muted">Loading…</p>

          <UCard v-if="openQuestions.length" class="ring-warning/50">
            <template #header>
              <h2 class="font-semibold">Waiting on you ({{ openQuestions.length }})</h2>
            </template>
            <ul class="space-y-2">
              <li v-for="q in openQuestions" :key="q.number" class="text-sm">
                <a :href="q.url" target="_blank" rel="noopener" class="text-primary">#{{ q.number }}</a>
                {{ q.title }}
              </li>
            </ul>
          </UCard>

          <p v-if="decisionsStatus !== 'pending' && !decisions.length && !openQuestions.length" class="text-muted">No decisions yet.</p>

          <ul v-if="decisions.length" class="divide-y divide-default rounded-lg border border-default">
            <li v-for="(d, idx) in decisions" :key="rowKey(d, idx)">
              <button
                type="button"
                class="flex w-full items-start gap-3 p-3 text-left"
                :aria-expanded="expanded === rowKey(d, idx)"
                @click="expanded = expanded === rowKey(d, idx) ? null : rowKey(d, idx)"
              >
                <span class="shrink-0 text-xs text-muted">{{ d.date }}</span>
                <span class="flex-1 text-sm">{{ d.decision }}</span>
                <UBadge variant="subtle" color="neutral" class="shrink-0">epic #{{ d.epic }}</UBadge>
              </button>
              <div v-if="expanded === rowKey(d, idx)" class="space-y-2 bg-elevated/50 px-3 pb-3 text-sm">
                <p v-if="d.why"><span class="font-semibold">Why:</span> {{ d.why }}</p>
                <p v-if="d.rejected"><span class="font-semibold">Not chosen:</span> {{ d.rejected }}</p>
                <p v-if="!d.why && !d.rejected" class="text-muted">No further detail recorded.</p>
                <a :href="`${REPO_URL}/issues/${d.epic}`" target="_blank" rel="noopener" class="text-primary">Open epic #{{ d.epic }}</a>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <!-- Changelog -->
      <template #changelog>
        <div class="space-y-4 py-4">
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
      </template>
    </UTabs>
  </UContainer>
</template>
