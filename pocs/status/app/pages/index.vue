<script setup lang="ts">
// The inbox: every card that waits on the owner, newest first. On load it syncs cards from
// GitHub (POST /api/cards/sync), then lists the stored ones. List/answer rules: utils/inbox-core.ts.
import { cardView, submitAnswer, waitingCards, type InboxCard, type SendAnswer } from '~/utils/inbox-core'

definePageMeta({ middleware: 'auth' })

const { getTeamId } = useTeamContext()

const cards = ref<InboxCard[]>([])
const loading = ref(true)
const syncError = ref<string | null>(null)
const loadError = ref<string | null>(null)

const errorText = (e: any, fallback: string) => e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? fallback

async function load() {
  loading.value = true
  loadError.value = null
  await $fetch('/api/cards/sync', { method: 'POST' }).catch((e) => {
    syncError.value = `Could not refresh from GitHub: ${errorText(e, 'sync failed')}`
  })
  try {
    // One-team mode: the slug `test1` resolves too if the team is not known on the client yet.
    const teamId = getTeamId() ?? 'test1'
    const result = await $fetch<InboxCard[]>(`/api/teams/${teamId}/inbox-cards`)
    cards.value = waitingCards(Array.isArray(result) ? result : [])
  } catch (e) {
    loadError.value = errorText(e, 'Could not load cards.')
  } finally {
    loading.value = false
  }
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
      <p v-else-if="!cards.length && !loadError" class="text-muted">Nothing waits on you.</p>

      <template v-for="c in cards" :key="c.id">
        <CardsEdit v-if="cardView(c) === 'edit'" :card="c" :send="answerFor(c.id)" />
        <CardsReview v-else-if="cardView(c) === 'review'" :card="c" :send="answerFor(c.id)" />
        <CardsIssue v-else-if="cardView(c) === 'issue'" :card="c" />
        <CardsPlaceholder v-else :card="c" />
      </template>
    </div>
  </UContainer>
</template>
