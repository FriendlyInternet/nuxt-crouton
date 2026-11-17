<script setup lang="ts">
// An open issue that waits on the owner. No answer buttons: the answer endpoint only answers
// review cards, so the reply happens on GitHub. A stuck card (#3880, `payload.stuck`) carries a
// `Stuck` badge; its reason is the card's ask.
import type { InboxCard } from '~/utils/inbox-core'

defineProps<{ card: InboxCard }>()
</script>

<template>
  <CardsBody :card="card" :badge="card.payload?.stuck ? 'Stuck' : undefined">
    <UButton block variant="outline" icon="i-lucide-external-link" label="Open on GitHub" :href="card.link" target="_blank" />
  </CardsBody>
</template>
