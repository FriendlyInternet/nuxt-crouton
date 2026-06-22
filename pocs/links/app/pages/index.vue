<script setup lang="ts">
// Public landing for the links POC. The admin area lives behind /admin (auth-gated).
definePageMeta({ layout: false })
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-4 bg-(--ui-bg) p-6 text-center">
    <UIcon name="i-lucide-link" class="size-10 text-(--ui-primary)" />
    <h1 class="text-2xl font-semibold text-(--ui-text-highlighted)">
      Links
    </h1>
    <p class="max-w-md text-(--ui-text-muted)">
      A crouton POC for managing links. The admin lives behind a login.
    </p>
    <UButton to="/admin" icon="i-lucide-lock" color="primary">
      Go to admin
    </UButton>
  </div>
</template>
