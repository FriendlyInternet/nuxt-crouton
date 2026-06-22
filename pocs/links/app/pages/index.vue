<script setup lang="ts">
// Public landing for the links POC. The admin area lives behind /admin (auth-gated).
definePageMeta({ layout: false })
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-(--ui-bg) p-6">
    <div class="flex flex-col items-center gap-6 text-center animate-fade-in">
      <!-- Icon with subtle background glow -->
      <div class="relative">
        <div class="absolute inset-0 rounded-full bg-(--ui-primary)/10 blur-xl scale-150" />
        <div class="relative flex items-center justify-center size-16 rounded-2xl bg-(--ui-primary)/10">
          <UIcon name="i-lucide-link" class="size-8 text-(--ui-primary)" />
        </div>
      </div>

      <!-- Title and description -->
      <div class="flex flex-col gap-2">
        <h1 class="text-3xl font-bold tracking-tight text-(--ui-text-highlighted)">
          Links
        </h1>
        <p class="max-w-sm text-(--ui-text-muted) text-base leading-relaxed">
          Save, tag, and organise your bookmarks. Log in to get started.
        </p>
      </div>

      <!-- CTA button -->
      <UButton
        to="/admin"
        icon="i-lucide-arrow-right"
        trailing
        color="primary"
        size="lg"
        class="transition-transform duration-200 hover:scale-105"
      >
        Go to admin
      </UButton>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
