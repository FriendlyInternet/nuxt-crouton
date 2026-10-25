<script setup lang="ts">
/**
 * BuilderToolbarBlock — a hug-height top bar. Registered as `app-toolbar` with
 * `sizing: { height: 'hug' }`, so it renders as a short pill wherever it lands
 * (intrinsic sizing — the block declares its own height, no per-instance size UI).
 * App-owned chrome block; resolved by name via `<component :is>` (registered
 * globally in `plugins/builder-blocks.ts`).
 */
import { BOARD_HIDDEN_KEY } from '~/utils/board-hidden'

withDefaults(defineProps<{ heading?: string }>(), { heading: 'App' })
// Hidden blocks placed "in the nav" (#2418) show as buttons on the bar.
const hidden = inject(BOARD_HIDDEN_KEY, null)
</script>

<template>
  <div class="flex h-14 items-center gap-3 border-b border-default bg-elevated px-4">
    <UIcon name="i-lucide-square-dashed" class="size-5 text-primary" />
    <span class="text-sm font-semibold">{{ heading }}</span>
    <div class="ml-auto flex items-center gap-2 text-muted">
      <UButton
        v-for="item in hidden?.navItems.value ?? []"
        :key="item.key"
        :icon="item.icon"
        :label="item.label"
        size="xs"
        color="neutral"
        variant="soft"
        :data-nav-item="item.key"
        @click.stop="hidden?.open(item.key)"
      />
      <UIcon name="i-lucide-search" class="size-4" />
      <UIcon name="i-lucide-bell" class="size-4" />
      <UAvatar size="2xs" icon="i-lucide-user" />
    </div>
  </div>
</template>
