<script setup lang="ts">
/**
 * CroutonSubBar — a thin, presentational secondary bar that sits under a primary
 * toolbar / header. It's a bordered, padded horizontal strip with leading /
 * default / trailing slots, optionally sticky over a scrolling container.
 *
 * It owns ONLY layout: spacing, the divider, background, horizontal-overflow
 * scrolling, (opt-in) sticky pinning, and (opt-in) auto-hide on scroll. It
 * deliberately hosts NO tabs / filter / dropdown logic — that's slot content. If
 * you ever reach for a `mode="tabs|filters"` prop, stop: the content belongs in
 * a slot.
 *
 * Consumers (epic #307): the pages editor language bar (leading = language
 * dropdown, trailing = Preview), sales settings tabs (default = tab strip,
 * sticky + auto-hide), the sales orders filter bar (default = filters, sticky +
 * auto-hide).
 *
 * @example
 * <CroutonSubBar sticky auto-hide>
 *   <template #leading><LanguageDropdown /></template>
 *   <template #trailing><UButton icon="i-lucide-eye" /></template>
 * </CroutonSubBar>
 */
interface Props {
  /** Pin to the top of the nearest scroll container while content scrolls under it. */
  sticky?: boolean
  /** Draw the bottom divider (default true). */
  bordered?: boolean
  /**
   * Hide the bar while scrolling DOWN and reveal it immediately on scroll UP
   * (the mobile-toolbar behaviour). Implies sticky — a non-pinned bar has
   * nothing to hide. No-op on the server.
   */
  autoHide?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  sticky: false,
  bordered: true,
  autoHide: false,
})

const root = ref<HTMLElement | null>(null)
const hidden = ref(false)
let prevY = 0
let cleanup: () => void = () => {}

onMounted(() => {
  if (!props.autoHide) return
  // Capture-phase so we catch the scroll of WHATEVER ancestor actually scrolls
  // (a pane body, a slideover, the document) without having to guess which
  // element it is — no `useScroll(ref)` timing games.
  const onScroll = (e: Event) => {
    const target = e.target as HTMLElement | Document | null
    if (!target || !root.value) return
    const el = (target === document ? document.scrollingElement : target) as HTMLElement | null
    if (!el || !el.contains?.(root.value)) return // only the scroller we live inside
    const newY = el.scrollTop
    // Hide on ANY downward scroll (past a tiny jitter deadzone), reveal on any
    // upward scroll. Only forced-shown when parked at the very top, so the bar
    // is always there when you arrive back at the start of the content.
    if (newY <= 4) hidden.value = false // parked at the top: shown
    else if (newY > prevY + 2) hidden.value = true // scrolling down: hide
    else if (newY < prevY - 2) hidden.value = false // scrolling up: reveal
    prevY = newY
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  cleanup = () => document.removeEventListener('scroll', onScroll, { capture: true })
})

onBeforeUnmount(() => cleanup())
</script>

<template>
  <div
    ref="root"
    class="flex items-center gap-2 px-2 py-1.5 bg-elevated/30 overflow-x-auto transition-transform duration-200 ease-out"
    :class="[
      bordered ? 'border-b border-default' : '',
      (sticky || autoHide) ? 'sticky top-0 z-10' : '',
      hidden ? '-translate-y-full' : 'translate-y-0',
    ]"
  >
    <slot name="leading" />
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <slot name="trailing" />
  </div>
</template>
