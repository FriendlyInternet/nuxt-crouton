<script setup lang="ts">
// A delivery card ("try it"): open the app already signed in, then Works / Not ok + note.
// Thin on purpose — the link and the result rules live in utils/delivery-core.ts.
import type { InboxCard } from '~/utils/inbox-core'
import { deliveryOpenLink } from '~/utils/delivery-core'

const props = defineProps<{
  card: InboxCard
  send: (verdict: 'ok' | 'not-ok', note: string) => Promise<{ error: string | null }>
}>()

const openLink = computed(() => deliveryOpenLink(props.card))
</script>

<template>
  <CardsBody :card="card">
    <UButton
      v-if="openLink"
      block
      size="lg"
      icon="i-lucide-log-in"
      label="Open and sign in"
      :href="openLink"
      target="_blank"
    />
    <a :href="card.link" target="_blank" rel="noopener" class="block text-sm text-primary">Open the epic on GitHub</a>
    <ReplyButtons ok-label="Works" :send="send" />
  </CardsBody>
</template>
