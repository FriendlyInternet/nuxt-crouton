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
  /**
   * Bleed out of a host that pads its scroll container (the standard `p-4`
   * pane) so the bar spans the FULL width edge-to-edge — content stays inset
   * to line up with the padded siblings. Use when the bar sits inside a padded
   * scroll area; omit when the host has no horizontal padding (the bar is
   * already full-width then).
   */
  flush?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  sticky: false,
  bordered: true,
  autoHide: false,
  flush: false,
})

const root = ref<HTMLElement | null>(null)
// The "headroom" pattern for `auto-hide`, with NO layout shift of the content:
//  - `pinned = false` → the bar sits in normal document flow. Scrolling DOWN
//    just carries it off the top like any other content (no reserved gap, the
//    list never moves).
//  - `pinned = true` → a scroll UP re-introduces it as a sticky overlay pinned
//    at the top; `shown` drives the slide (-100% → 0). Content scrolls under it.
// Releasing pinned→flow only happens back at the very top (slot aligns) or after
// the hide-slide finishes, so neither transition jumps.
const pinned = ref(false)
const shown = ref(false)
let prevY = 0
let raf = 0
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
    if (newY <= 4) {
      // Parked at the top: release into flow, fully visible.
      pinned.value = false
      shown.value = false
    }
    else if (newY > prevY + 2) {
      // Scrolling down: let the bar ride away in flow. If it's currently a
      // pinned overlay, slide it up first — it drops back to flow on transitionend.
      if (pinned.value) shown.value = false
    }
    else if (newY < prevY - 2) {
      // Scrolling up: reveal as a sticky overlay sliding in from the top.
      if (!pinned.value) {
        pinned.value = true // becomes sticky, rendered hidden (-100%)…
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => { shown.value = true }) // …then slides in
      }
      else {
        shown.value = true
      }
    }
    prevY = newY
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  cleanup = () => {
    document.removeEventListener('scroll', onScroll, { capture: true })
    cancelAnimationFrame(raf)
  }
})

// After the hide-slide completes, drop the overlay back into normal flow.
function onSlideEnd() {
  if (pinned.value && !shown.value) pinned.value = false
}

onBeforeUnmount(() => cleanup())
</script>

<template>
  <div
    ref="root"
    class="flex items-center gap-2 py-1.5 bg-default overflow-x-auto transition-transform duration-200 ease-out"
    :class="[
      bordered ? 'border-b border-default' : '',
      // auto-hide: sticky ONLY while pinned (a scroll-up reveal); otherwise the
      // bar lives in flow. A plain `sticky` bar (no auto-hide) always pins.
      autoHide ? (pinned ? 'sticky top-0 z-10' : '') : (sticky ? 'sticky top-0 z-10' : ''),
      (autoHide && pinned && !shown) ? '-translate-y-full' : 'translate-y-0',
      // Full-bleed inside a `p-4` pane: cancel the host's horizontal padding,
      // re-inset the content by the same amount so it lines up with the padded
      // siblings below. Plain `px-2` otherwise.
      flush ? '-mx-4 px-4' : 'px-2',
    ]"
    @transitionend="onSlideEnd"
  >
    <slot name="leading" />
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <slot name="trailing" />
  </div>
</template>
