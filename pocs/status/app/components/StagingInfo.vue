<script setup lang="ts">
defineProps<{ url?: string | null, signIn?: string | null, roles?: boolean }>()
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs font-semibold uppercase text-muted">Staging</p>
    <p v-if="!url" class="text-sm text-muted">No staging URL configured.</p>
    <a v-else :href="url" target="_blank" rel="noopener" class="block break-all text-sm text-primary">{{ url }}</a>
    <StagingSignIn :sign-in="signIn" :roles="roles" />
  </div>
</template>
