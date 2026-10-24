<script setup lang="ts">
// fallow-ignore-file unused-component-props
/**
 * CroutonUserPill Stub
 *
 * Fallback when @fyit/crouton-auth is not installed.
 * Renders nothing — the real component is provided by crouton-auth at default priority.
 */
defineProps<{
  showStatus?: boolean
  compact?: 'auto' | 'always' | 'never'
  placement?: 'fixed' | 'inline'
  extraItems?: unknown[]
  useModal?: boolean
}>()
</script>

<template>
  <!-- Stub: overridden by @fyit/crouton-auth when present -->
</template>
