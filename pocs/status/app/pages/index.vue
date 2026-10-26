<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const tabs = [
  { label: 'To test', slot: 'to-test' },
  { label: 'Decisions', slot: 'decisions' },
  { label: 'Changelog', slot: 'changelog' }
]
</script>

<template>
  <UContainer class="py-6">
    <UTabs :items="tabs" class="w-full">
      <template #to-test>
        <p class="py-6 text-muted">Nothing to test yet.</p>
      </template>
      <template #decisions>
        <p class="py-6 text-muted">No decisions yet.</p>
      </template>
      <template #changelog>
        <p class="py-6 text-muted">No changes yet.</p>
      </template>
    </UTabs>
  </UContainer>
</template>
