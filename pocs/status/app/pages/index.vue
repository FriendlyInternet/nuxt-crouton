<script setup lang="ts">
// The inbox: every card that waits on the owner, newest first. The server renders the stored
// cards (no GitHub call), then the browser syncs from GitHub (POST /api/cards/sync) in the
// background and lists again. While the tab is visible it re-reads the stored cards every 30 s and
// when it becomes visible again (#4309: the clock syncs after a GitHub webhook), never syncing itself.
// Load/list/answer rules: utils/inbox-core.ts.
import { sendDelivery } from '~/utils/delivery-core'
import CardsEdit from '~/components/cards/Edit.vue'
import CardsReview from '~/components/cards/Review.vue'
import CardsIssue from '~/components/cards/Issue.vue'
import CardsDelivery from '~/components/cards/Delivery.vue'
import CardsQuizCard from '~/components/cards/QuizCard.vue'
import CardsPlaceholder from '~/components/cards/Placeholder.vue'
import { REREAD_MS, cardView, errorText, nothingWaits, refreshInbox, relistInbox, rereadDue, submitAnswer, waitingCards, type InboxCard, type InboxLoadState, type SendAnswer } from '~/utils/inbox-core'

definePageMeta({ middleware: 'auth' })

const { getTeamId } = useTeamContext()
// One-team mode: the slug `test1` resolves too if the team is not known yet.
const listUrl = `/api/teams/${getTeamId() ?? 'test1'}/inbox-cards`

// Stored cards only, fetched during the server render so the first HTML already shows them.
const { data: stored, error: storedError } = await useFetch<InboxCard[]>(listUrl)

const cards = ref<InboxCard[]>(waitingCards(Array.isArray(stored.value) ? stored.value : []))
const loading = ref(false)
// The GitHub refresh runs once the page is open; until it ends, an empty list is not "nothing".
const refreshing = ref(true)
const syncError = ref<string | null>(null)
const loadError = ref<string | null>(storedError.value ? errorText(storedError.value, 'Could not load cards.') : null)

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

function refresh() {
  return refreshInbox({
    list: () => $fetch<InboxCard[]>(listUrl),
    sync: () => $fetch<unknown>('/api/cards/sync', { method: 'POST' }),
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

// A delivery card's "Works" button is ReplyButtons' ok → sent as `works` (posts `ok` on the epic).
const sendDeliveryToServer: SendAnswer = (cardId, body) =>
  sendDelivery({ cardId, verdict: body.verdict === 'ok' ? 'works' : 'not-ok', note: body.note })

// ReplyButtons calls this; on success the card leaves the list (and unmounts).
const answerFor = (cardId: string, send: SendAnswer = sendToServer) => async (verdict: 'ok' | 'not-ok', note: string) => {
  const res = await submitAnswer({ cards: cards.value, cardId, input: { verdict, note }, send })
  cards.value = res.cards
  return { error: res.error }
}

// A quiz card sends its `1B 2A 3C` line; on success the card leaves the list, on failure it stays.
const quizFor = (cardId: string) => async (answer: string) => {
  try {
    await $fetch(`/api/cards/${cardId}/answer`, { method: 'POST', body: { answer } })
    cards.value = cards.value.filter(x => x.id !== cardId)
    return { error: null }
  } catch (e) {
    return { error: errorText(e, 'Could not send.') }
  }
}

// One component per card view; answerable views also get their `send`.
const cardComponents = {
  edit: CardsEdit,
  review: CardsReview,
  issue: CardsIssue,
  delivery: CardsDelivery,
  quiz: CardsQuizCard,
  placeholder: CardsPlaceholder
}
const cardProps = (c: InboxCard) => {
  const view = cardView(c)
  if (view === 'delivery') return { card: c, send: answerFor(c.id, sendDeliveryToServer) }
  if (view === 'quiz') return { card: c, send: quizFor(c.id) }
  if (view === 'edit' || view === 'review') return { card: c, send: answerFor(c.id) }
  return { card: c }
}

onMounted(refresh)

// Pick up cards the clock synced after a GitHub change, without a reload (stored list only).
const visibility = useDocumentVisibility()
function reread() {
  if (!rereadDue({ visible: visibility.value === 'visible', busy: refreshing.value || loading.value })) return
  relistInbox({
    list: () => $fetch<InboxCard[]>(listUrl),
    sync: () => Promise.resolve(null),
    update: applyLoad
  })
}
useIntervalFn(reread, REREAD_MS)
watch(visibility, (v) => {
  if (v === 'visible') reread()
})
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

      <component :is="cardComponents[cardView(c)]" v-for="c in cards" :key="c.id" v-bind="cardProps(c)" />
    </div>
  </UContainer>
</template>
