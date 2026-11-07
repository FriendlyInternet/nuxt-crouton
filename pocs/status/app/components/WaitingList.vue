<script setup lang="ts">
defineProps<{ questions: Array<{ number: number, title: string, url: string }> }>()
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs font-semibold uppercase text-muted">Waiting on you</p>
    <ul class="space-y-1">
      <li v-for="q in questions" :key="q.number" class="text-sm">
        <a :href="q.url" target="_blank" rel="noopener" class="text-primary">#{{ q.number }}</a>
        {{ q.title }}
      </li>
    </ul>
  </div>
</template>
