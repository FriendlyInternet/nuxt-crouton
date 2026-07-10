<script setup lang="ts">
// Silkscreen label — small, gray, letterspaced, exactly where it should be.
interface Props {
  variant?: 'default' | 'orange'
}

withDefaults(defineProps<Props>(), {
  variant: 'default'
})
</script>

<template>
  <span class="braun-label" :class="`braun-label--${variant}`">
    <slot />
  </span>
</template>

<style scoped>
.braun-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--braun-label);
}

.braun-label--orange {
  color: var(--braun-orange);
}
</style>
