<script setup lang="ts">
defineProps<{ decisions: Array<{ date: string, epic: number, decision: string, why: string, rejected: string }> }>()

const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'
</script>

<template>
  <details>
    <summary class="cursor-pointer text-sm font-semibold">Decisions ({{ decisions.length }})</summary>
    <ul class="mt-2 space-y-3">
      <li v-for="(d, idx) in decisions" :key="`${d.epic}-${idx}`" class="space-y-1 text-sm">
        <p><span class="text-xs text-muted">{{ d.date }}</span> {{ d.decision }}</p>
        <p v-if="d.why"><span class="font-semibold">Why:</span> {{ d.why }}</p>
        <p v-if="d.rejected"><span class="font-semibold">Not chosen:</span> {{ d.rejected }}</p>
        <a :href="`${REPO_URL}/issues/${d.epic}`" target="_blank" rel="noopener" class="text-primary">Open epic #{{ d.epic }}</a>
      </li>
    </ul>
  </details>
</template>
