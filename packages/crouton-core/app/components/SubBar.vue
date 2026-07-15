<script setup lang="ts">
/**
 * CroutonSubBar — a thin, presentational secondary bar that sits under a primary
 * toolbar / header. It's a bordered, padded horizontal strip with leading /
 * default / trailing slots, optionally sticky over a scrolling container.
 *
 * It owns ONLY layout: spacing, the divider, background, horizontal-overflow
 * scrolling, and (opt-in) sticky pinning. It deliberately hosts NO tabs / filter
 * / dropdown logic — that's slot content. If you ever reach for a
 * `mode="tabs|filters"` prop, stop: the content belongs in a slot.
 *
 * Consumers (epic #307): the pages editor language bar (leading = language
 * dropdown, trailing = Preview), sales settings tabs (default = UTabs, sticky),
 * the orders filter bar (default = filters, sticky).
 *
 * @example
 * <CroutonSubBar sticky>
 *   <template #leading><LanguageDropdown /></template>
 *   <template #trailing><UButton icon="i-lucide-eye" /></template>
 * </CroutonSubBar>
 */
interface Props {
  /** Pin to the top of the nearest scroll container while content scrolls under it. */
  sticky?: boolean
  /** Draw the bottom divider (default true). */
  bordered?: boolean
}

withDefaults(defineProps<Props>(), {
  sticky: false,
  bordered: true,
})
</script>

<template>
  <div
    class="flex items-center gap-2 px-2 py-1.5 bg-elevated/30 overflow-x-auto"
    :class="[
      bordered ? 'border-b border-default' : '',
      sticky ? 'sticky top-0 z-10' : '',
    ]"
  >
    <slot name="leading" />
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <slot name="trailing" />
  </div>
</template>
