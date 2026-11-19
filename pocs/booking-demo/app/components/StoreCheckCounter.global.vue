<script setup lang="ts">
// A stateless test block (#3650): it shows what its layout store feeds it and
// emits `bump` — it never reads the store itself. Global (`.global.vue`) because
// the layout renderer resolves blocks by component NAME.
withDefaults(defineProps<{ count?: number, label?: string }>(), { count: 0, label: 'no store' })
defineEmits<{ bump: [] }>()
</script>

<template>
  <div class="p-3">
    <UButton data-testid="store-check-counter" :data-label="label" @click="$emit('bump')">
      {{ label }}: {{ count }}
    </UButton>
  </div>
</template>
