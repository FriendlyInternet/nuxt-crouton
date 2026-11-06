<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

// One-tap staging sign-in per role (#3421).
const STAGING_ROLES = [
  { role: 'member', label: 'Member' },
  { role: 'admin', label: 'Admin' },
  { role: 'superadmin', label: 'Super admin' }
]

interface ToTestItem {
  kind: 'epic' | 'pr'
  number: number
  title: string
  url: string
  app: string | null
  what: string
  steps: string[]
  to: string
}
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

const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'

const { data: appsRes, status: appsStatus } = await useFetch<{ data: AppCard[] | null, error: string | null }>('/api/status/apps', { lazy: true })
// The server already orders cards (General last, most to test first).
const cards = computed(() => (appsRes.value?.data ?? []).map(c => ({ card: c, v: toCardView(c) })))

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
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

      <template v-for="{ card, v } in cards" :key="card.app ?? 'general'">
        <div v-if="v.collapsed" class="flex items-center gap-3 rounded-lg border border-default p-3">
          <h2 class="flex-1 font-semibold">{{ v.title }}</h2>
          <UButton v-if="v.signIn" size="sm" icon="i-lucide-log-in" label="Open and sign in" :href="v.signIn" target="_blank" />
          <a :href="v.lastMergedHref" target="_blank" rel="noopener" class="text-sm text-primary">Last merged</a>
        </div>

        <UCard v-else>
          <template #header>
            <div class="flex items-center gap-2">
              <h2 class="text-lg font-semibold">{{ v.title }}</h2>
              <UBadge v-if="v.count" color="warning" variant="subtle">{{ v.count }} to test</UBadge>
            </div>
          </template>
          <div class="space-y-4">
            <div v-if="card.app" class="space-y-2">
              <p class="text-xs font-semibold uppercase text-muted">Staging</p>
              <p v-if="!card.stagingUrl" class="text-sm text-muted">No staging URL configured.</p>
              <a v-else :href="card.stagingUrl" target="_blank" rel="noopener" class="block break-all text-sm text-primary">{{ card.stagingUrl }}</a>
              <div v-if="card.hasSignIn" class="flex gap-2">
                <UButton
                  v-for="r in STAGING_ROLES"
                  :key="r.role"
                  size="sm"
                  variant="solid"
                  class="flex-1 justify-center"
                  :label="r.label"
                  :href="`${v.signIn}&role=${r.role}`"
                  target="_blank"
                />
              </div>
              <UButton v-else-if="v.signIn" block icon="i-lucide-log-in" label="Open and sign in" :href="v.signIn" target="_blank" />
            </div>

            <div v-if="v.count" class="space-y-3">
              <p class="text-xs font-semibold uppercase text-muted">To test</p>
              <div v-for="p in v.previews" :key="`pr-${p.pr}`" class="space-y-2 rounded-lg border border-default p-3">
                <div class="flex items-start gap-2">
                  <span class="flex-1 text-sm font-medium">{{ p.title }}</span>
                  <a :href="`${REPO_URL}/pull/${p.pr}`" target="_blank" rel="noopener" class="text-sm text-primary">#{{ p.pr }}</a>
                </div>
                <p class="text-xs text-muted">Updated {{ day(p.updatedAt) }}</p>
                <div v-if="card.hasSignIn && p.signIn" class="flex gap-2">
                <UButton
                  v-for="r in STAGING_ROLES"
                  :key="r.role"
                  size="sm"
                  variant="outline"
                  class="flex-1 justify-center"
                  :label="r.label"
                  :href="`${p.signIn}&role=${r.role}`"
                  target="_blank"
                />
              </div>
              <UButton v-else-if="p.signIn" block variant="outline" icon="i-lucide-log-in" label="Open and sign in" :href="p.signIn" target="_blank" />
                <ReplyButtons kind="pr" :number="p.pr" />
              </div>
              <div v-for="i in v.toTest" :key="`${i.kind}-${i.number}`" class="space-y-2 rounded-lg border border-default p-3">
                <div class="flex items-start gap-2">
                  <h3 class="flex-1 text-sm font-medium">{{ i.title }}</h3>
                  <a :href="i.url" target="_blank" rel="noopener" class="text-sm text-primary">#{{ i.number }}</a>
                </div>
                <p v-if="i.what" class="text-sm">{{ i.what }}</p>
                <ol v-if="i.steps.length" class="list-decimal space-y-1 pl-5 text-sm">
                  <li v-for="(s, n) in i.steps" :key="n">{{ s }}</li>
                </ol>
                <UButton v-if="i.signIn" block icon="i-lucide-log-in" label="Open and sign in" :href="i.signIn" target="_blank" />
                <ReplyButtons v-if="i.kind === 'epic'" kind="issue" :number="i.number" />
              </div>
            </div>

            <div v-if="v.waiting.length" class="space-y-2">
              <p class="text-xs font-semibold uppercase text-muted">Waiting on you</p>
              <ul class="space-y-1">
                <li v-for="q in v.waiting" :key="q.number" class="text-sm">
                  <a :href="q.url" target="_blank" rel="noopener" class="text-primary">#{{ q.number }}</a>
                  {{ q.title }}
                </li>
              </ul>
            </div>

            <details v-if="card.decisions.length">
              <summary class="cursor-pointer text-sm font-semibold">Decisions ({{ card.decisions.length }})</summary>
              <ul class="mt-2 space-y-3">
                <li v-for="(d, idx) in card.decisions" :key="`${d.epic}-${idx}`" class="space-y-1 text-sm">
                  <p><span class="text-xs text-muted">{{ d.date }}</span> {{ d.decision }}</p>
                  <p v-if="d.why"><span class="font-semibold">Why:</span> {{ d.why }}</p>
                  <p v-if="d.rejected"><span class="font-semibold">Not chosen:</span> {{ d.rejected }}</p>
                  <a :href="`${REPO_URL}/issues/${d.epic}`" target="_blank" rel="noopener" class="text-primary">Open epic #{{ d.epic }}</a>
                </li>
              </ul>
            </details>
          </div>
          <template #footer>
            <a :href="v.lastMergedHref" target="_blank" rel="noopener" class="text-sm text-primary">Last merged →</a>
          </template>
        </UCard>
      </template>
    </div>
  </UContainer>
</template>
