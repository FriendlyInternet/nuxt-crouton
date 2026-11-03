<script setup lang="ts">
/**
 * BuilderNavBlock — a hug-height bottom navigation bar. Registered as `app-nav`
 * with `sizing: { height: 'hug' }` → a short bar wherever it lands. App-owned
 * chrome block; resolved by name via `<component :is>`.
 */
import { BOARD_HIDDEN_KEY } from '~/utils/board-hidden'

// Hidden blocks whose trigger is "in the nav" (#2418) become this bar's items;
// without any, the demo items show what the bar looks like.
const hidden = inject(BOARD_HIDDEN_KEY, null)
const demo = [
  { icon: 'i-lucide-home', label: 'Home', key: '' },
  { icon: 'i-lucide-search', label: 'Search', key: '' },
  { icon: 'i-lucide-plus', label: 'Add', key: '' },
  { icon: 'i-lucide-user', label: 'You', key: '' },
]
const items = computed(() => (hidden?.navItems.value.length ? hidden.navItems.value : demo))
</script>

<template>
  <div class="flex h-16 items-center justify-around border-t border-default bg-elevated px-2">
    <button
      v-for="item in items"
      :key="item.label"
      type="button"
      class="flex flex-col items-center gap-0.5 text-muted"
      :class="item.key ? 'text-default' : ''"
      :data-nav-item="item.key || undefined"
      @click.stop="item.key && hidden?.open(item.key)"
    >
      <UIcon :name="item.icon" class="size-5" />
      <span class="text-[10px]">{{ item.label }}</span>
    </button>
  </div>
</template>
