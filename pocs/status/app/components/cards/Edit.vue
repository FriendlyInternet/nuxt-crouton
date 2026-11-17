<script setup lang="ts">
// A review ask that comes with an editor (payload.editUrl): open the editor, then Ok / Not ok.
// It is still a `review` card, so the answer endpoint accepts the reply.
import type { InboxCard } from '~/utils/inbox-core'

const props = defineProps<{
  card: InboxCard
  send: (verdict: 'ok' | 'not-ok', note: string) => Promise<{ error: string | null }>
}>()

const editUrl = computed(() => {
  const url = props.card.payload?.editUrl
  return typeof url === 'string' ? url : undefined
})
</script>

<template>
  <CardsBody :card="card">
    <UButton block size="lg" icon="i-lucide-pencil" label="Open editor" :href="editUrl" target="_blank" />
    <a :href="card.link" target="_blank" rel="noopener" class="block text-sm text-primary">Open on GitHub</a>
    <ReplyButtons ok-label="Ok" :send="send" />
  </CardsBody>
</template>
