<script setup lang="ts">
// One decisions-log row; tap to show why and what was not chosen.
import { REPO_URL, type Decision } from '~/utils/status-types'

defineProps<{ decision: Decision, open: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <li>
    <button
      type="button"
      class="flex w-full items-start gap-3 p-3 text-left"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <span class="shrink-0 text-xs text-muted">{{ decision.date }}</span>
      <span class="flex-1 text-sm">{{ decision.decision }}</span>
      <UBadge variant="subtle" color="neutral" class="shrink-0">epic #{{ decision.epic }}</UBadge>
    </button>
    <div v-if="open" class="space-y-2 bg-elevated/50 px-3 pb-3 text-sm">
      <p v-if="decision.why"><span class="font-semibold">Why:</span> {{ decision.why }}</p>
      <p v-if="decision.rejected"><span class="font-semibold">Not chosen:</span> {{ decision.rejected }}</p>
      <p v-if="!decision.why && !decision.rejected" class="text-muted">No further detail recorded.</p>
      <a :href="`${REPO_URL}/issues/${decision.epic}`" target="_blank" rel="noopener" class="text-primary">Open epic #{{ decision.epic }}</a>
    </div>
  </li>
</template>
