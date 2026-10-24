<script setup lang="ts">
/**
 * BuilderNavBlock — a hug-height bottom navigation bar. Registered as `app-nav`
 * with `sizing: { height: 'hug' }` → a short bar wherever it lands. App-owned
 * chrome block; resolved by name via `<component :is>`.
 */
const items = [
  { icon: 'i-lucide-home', label: 'Home' },
  { icon: 'i-lucide-search', label: 'Search' },
  { icon: 'i-lucide-plus', label: 'Add' },
  { icon: 'i-lucide-user', label: 'You' },
]
</script>

<template>
  <div class="flex h-16 items-center justify-around border-t border-default bg-elevated px-2">
    <div
      v-for="item in items"
      :key="item.label"
      class="flex flex-col items-center gap-0.5 text-muted"
    >
      <UIcon :name="item.icon" class="size-5" />
      <span class="text-[10px]">{{ item.label }}</span>
    </div>
  </div>
</template>
