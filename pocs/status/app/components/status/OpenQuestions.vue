<script setup lang="ts">
// The "Waiting on you" box at the top of the Decisions tab.
import type { OpenQuestion } from '~/utils/status-types'

defineProps<{ questions: OpenQuestion[] }>()
</script>

<template>
  <UCard class="ring-warning/50">
    <template #header>
      <h2 class="font-semibold">Waiting on you ({{ questions.length }})</h2>
    </template>
    <ul class="space-y-2">
      <li v-for="q in questions" :key="q.number" class="text-sm">
        <a :href="q.url" target="_blank" rel="noopener" class="text-primary">#{{ q.number }}</a>
        {{ q.title }}
      </li>
    </ul>
  </UCard>
</template>
