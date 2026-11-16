<script setup lang="ts">
// An open issue that waits on the owner. No answer buttons: the answer endpoint only answers
// review cards, so the reply happens on GitHub.
import type { InboxCard } from '~/utils/inbox-core'

defineProps<{ card: InboxCard }>()
</script>

<template>
  <CardsBody :card="card">
    <UButton block variant="outline" icon="i-lucide-external-link" label="Open on GitHub" :href="card.link" target="_blank" />
  </CardsBody>
</template>
