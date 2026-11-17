<script setup lang="ts">
// The fetch error alert + "Loading…" / empty line every dashboard tab starts with.
// `empty` unset = no empty line (the Decisions tab words its own).
defineProps<{ error?: string | null, pending: boolean, empty?: string | null }>()
</script>

<template>
  <UAlert v-if="error" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
  <p v-if="pending" class="text-muted">Loading…</p>
  <p v-else-if="empty" class="text-muted">{{ empty }}</p>
</template>
