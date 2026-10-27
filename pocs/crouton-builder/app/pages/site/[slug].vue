<script setup lang="ts">
/**
 * /site/[slug] — the SERVED page (#2457): what you designed in the builder,
 * as the page itself. No editing chrome.
 *
 * The page's live variant is resolved at the real viewport width (the same
 * breakpoint rules the builder authors against), blocks hidden at that width
 * leave the layout, and their triggers — edge buttons or nav items — open them
 * the way their recipe says. Same `HiddenBlocks` layer and nav blocks as the
 * builder, so there is one behaviour, not a preview of it.
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { resolveLayoutAtWidth, partitionCollapsed } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { useWindowSize } from '@vueuse/core'
import { BOARD_HIDDEN_KEY, collectHidden, collapsePlacement, type HiddenItem } from '~/utils/board-hidden'

// Addressed by slug (#2490): the page is read through /api/site/:slug, which
// returns only its title and live layout — no team id in the URL. The visitor
// still signs in: the collection blocks (list, form) are team-scoped, so an
// anonymous render would be an empty frame. A truly public page needs a public
// data path for its blocks — a follow-up, not this ticket.
definePageMeta({ middleware: ['auth'] })
const route = useRoute()
// List + Form blocks of one collection share which record is open (#2598).
provideCollectionSelections()
const slug = computed(() => String(route.params.slug))
const { data: page } = await useFetch<{ title: string, board: Record<string, unknown> }>(() => `/api/site/${encodeURIComponent(slug.value)}`)
useHead({ title: () => page.value?.title ?? 'Page' })

const { blocks } = useCroutonLayoutBlocks()

// The live variant's tree. `{ live, variants }` (#942) or the older `{ layout }`.
const tree = computed<LayoutTree | null>(() => {
  const board = (page.value?.board as Record<string, unknown> | null) ?? null
  if (!board) return null
  const variants = Array.isArray(board.variants) ? board.variants as { id: string, layout: string }[] : null
  const live = variants?.find(v => v.id === board.live) ?? variants?.[0]
  const stored = live?.layout ?? (typeof board.layout === 'string' ? board.layout : null)
  return stored ? parseLayoutTree(stored) : null
})

// Resolved at the real width of the device — this IS the served breakpoint.
const { width } = useWindowSize()
const resolved = computed(() => (tree.value && width.value ? resolveLayoutAtWidth(tree.value, width.value) : null))
const hiddenSet = computed(() => new Set(resolved.value?.collapsed ?? []))
const visibleRoot = computed(() => (resolved.value ? partitionCollapsed(resolved.value.root, resolved.value.collapsed).visible : null))

const hiddenItems = computed<HiddenItem[]>(() => collectHidden(resolved.value?.root ?? null, hiddenSet.value, id => ({
  label: blocks.value[id]?.name ?? id,
  icon: blocks.value[id]?.icon ?? 'i-lucide-box',
})))
const navItems = computed(() => hiddenItems.value.filter(i => collapsePlacement(i.recipe) === 'nav'))
const hiddenLayer = ref<{ open: (id: string) => void } | null>(null)
// ?debug=1 — what this device actually resolved (width, breakpoint, visible tree, hidden).
const debug = computed(() => route.query.debug !== undefined)
// What the DOM did (measured after paint): pane boxes, form presence, JS errors.
const dom = ref<{ panes: string[], forms: number, errors: string[] } | null>(null)
const errors: string[] = []
onMounted(() => {
  if (!debug.value) return
  window.addEventListener('error', e => errors.push(String(e.message)))
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
  const measure = () => {
    dom.value = {
      panes: Array.from(document.querySelectorAll('[data-handoff="served-page"] .croutonpane')).map((el) => {
        const r = el.getBoundingClientRect()
        return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 18)}"`
      }),
      forms: document.querySelectorAll('[data-handoff="served-page"] form').length,
      errors: [...errors],
    }
  }
  setTimeout(measure, 3000)
  setTimeout(measure, 10000)
})
const debugText = computed(() => JSON.stringify({
  ua: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 80),
  dom: dom.value,
  width: width.value,
  activeBreakpoint: resolved.value?.activeBreakpoint ?? null,
  collapsed: resolved.value?.collapsed ?? [],
  hidden: hiddenItems.value.map(i => ({ key: i.key, placement: collapsePlacement(i.recipe) })),
  visible: visibleRoot.value,
  variants: (page.value?.board as { variants?: unknown[] } | null)?.variants?.length ?? 0,
  live: (page.value?.board as { live?: string } | null)?.live ?? null,
}, null, 1))
provide(BOARD_HIDDEN_KEY, { navItems, items: hiddenItems, open: id => hiddenLayer.value?.open(id) })
</script>

<template>
  <div class="min-h-dvh bg-default" data-handoff="served-page">
    <div v-if="!page" class="flex min-h-dvh items-center justify-center p-6 text-sm text-muted">
      No page with that address.
    </div>
    <template v-else>
      <!-- Breakpoints are resolved on the client's real width; render after mount so SSR
           doesn't pick a desktop arrangement for a phone. -->
      <ClientOnly>
        <CroutonLayoutRenderer v-if="visibleRoot" :node="visibleRoot" :interactive="false" :key="resolved?.activeBreakpoint ?? 'base'" />
        <div v-else class="flex min-h-dvh items-center justify-center p-6 text-sm text-muted">
          Nothing to show at this width.
        </div>
        <BoardHiddenBlocks ref="hiddenLayer" :items="hiddenItems" />
        <pre v-if="debug" class="whitespace-pre-wrap break-all border-t border-default p-3 text-[11px] text-muted" data-handoff="served-debug">{{ debugText }}</pre>
      </ClientOnly>
    </template>
  </div>
</template>
