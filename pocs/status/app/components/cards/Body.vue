<script setup lang="ts">
// Shared frame for every inbox card: title (+ optional badge), the ask, the recommendation.
// Each card kind puts its own actions in the default slot.
import type { InboxCard } from '~/utils/inbox-core'

defineProps<{ card: InboxCard, badge?: string }>()
</script>

<template>
  <UCard>
    <div class="space-y-3">
      <div class="flex items-start gap-2">
        <h3 class="flex-1 font-medium">{{ card.title }}</h3>
        <UBadge v-if="badge" variant="subtle" color="neutral">{{ badge }}</UBadge>
      </div>
      <p class="text-sm">{{ card.ask }}</p>
      <p v-if="card.recommendation" class="text-sm text-muted">
        <span class="font-semibold">Recommended:</span> {{ card.recommendation }}
      </p>
      <slot />
    </div>
  </UCard>
</template>
