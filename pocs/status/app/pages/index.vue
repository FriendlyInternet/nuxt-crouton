<script setup lang="ts">
// The inbox: every card that waits on the owner, newest first. On load it shows the stored cards
// at once, then syncs from GitHub (POST /api/cards/sync) in the background and lists again.
// Load/list/answer rules: utils/inbox-core.ts.
import { cardView, loadInbox, nothingWaits, submitAnswer, type InboxCard, type InboxLoadState, type SendAnswer } from '~/utils/inbox-core'

definePageMeta({ middleware: 'auth' })

const { getTeamId } = useTeamContext()

const cards = ref<InboxCard[]>([])
const loading = ref(true)
const refreshing = ref(false)
const syncError = ref<string | null>(null)
const loadError = ref<string | null>(null)

const showNothing = computed(() => nothingWaits({
  cards: cards.value,
  loading: loading.value,
  refreshing: refreshing.value,
  loadError: loadError.value,
  syncError: syncError.value
}))

function applyLoad(patch: Partial<InboxLoadState>) {
  if (patch.cards !== undefined) cards.value = patch.cards
  if (patch.loading !== undefined) loading.value = patch.loading
  if (patch.refreshing !== undefined) refreshing.value = patch.refreshing
  if (patch.loadError !== undefined) loadError.value = patch.loadError
  if (patch.syncError !== undefined) syncError.value = patch.syncError
}

function load() {
  return loadInbox({
    // One-team mode: the slug `test1` resolves too if the team is not known on the client yet.
    list: () => $fetch<InboxCard[]>(`/api/teams/${getTeamId() ?? 'test1'}/inbox-cards`),
    sync: async () => { await $fetch('/api/cards/sync', { method: 'POST' }) },
    update: applyLoad
  })
}

const sendToServer: SendAnswer = async (cardId, body) => {
  try {
    await $fetch(`/api/cards/${cardId}/answer`, { method: 'POST', body })
    return { status: 200, error: null }
  } catch (e: any) {
    return { status: e?.statusCode ?? 500, error: e?.data?.statusMessage ?? e?.statusMessage ?? null }
  }
}

// ReplyButtons calls this; on success the card leaves the list (and unmounts).
const answerFor = (cardId: string) => async (verdict: 'ok' | 'not-ok', note: string) => {
  const res = await submitAnswer({ cards: cards.value, cardId, input: { verdict, note }, send: sendToServer })
  cards.value = res.cards
  return { error: res.error }
}

onMounted(load)
</script>

<template>
  <UContainer class="@container py-4 sm:py-6">
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <h1 class="flex-1 text-xl font-semibold">Waiting for you</h1>
      <UButton to="/apps" variant="outline" icon="i-lucide-layout-grid" label="All apps" />
    </div>

    <div class="space-y-4">
      <UAlert v-if="syncError" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="syncError" />
      <UAlert v-if="loadError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="loadError" />

      <p v-if="loading" class="text-muted">Loading…</p>
      <p v-else-if="showNothing" class="text-muted">Nothing waits on you.</p>
      <p v-else-if="refreshing && !cards.length && !loadError" class="text-muted">Checking GitHub…</p>

      <template v-for="c in cards" :key="c.id">
        <CardsEdit v-if="cardView(c) === 'edit'" :card="c" :send="answerFor(c.id)" />
        <CardsReview v-else-if="cardView(c) === 'review'" :card="c" :send="answerFor(c.id)" />
        <CardsIssue v-else-if="cardView(c) === 'issue'" :card="c" />
        <CardsPlaceholder v-else :card="c" />
      </template>
    </div>
  </UContainer>
</template>
