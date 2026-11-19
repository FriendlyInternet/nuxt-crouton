<script setup lang="ts">
// Choice cards (and a quiz whose text could not be read) until their own components land:
// show the ask and send the owner to GitHub to answer.
import type { InboxCard } from '~/utils/inbox-core'

defineProps<{ card: InboxCard }>()
</script>

<template>
  <CardsBody :card="card" :badge="card.kind">
    <UButton block variant="outline" icon="i-lucide-external-link" label="Answer on GitHub" :href="card.link" target="_blank" />
  </CardsBody>
</template>
