<script setup lang="ts">
// A review ask: read it, then Ok / Not ok + note, answered straight from the inbox.
import type { InboxCard } from '~/utils/inbox-core'

defineProps<{
  card: InboxCard
  send: (verdict: 'ok' | 'not-ok', note: string) => Promise<{ error: string | null }>
}>()
</script>

<template>
  <CardsBody :card="card">
    <a :href="card.link" target="_blank" rel="noopener" class="block text-sm text-primary">Open on GitHub</a>
    <ReplyButtons ok-label="Ok" :send="send" />
  </CardsBody>
</template>
