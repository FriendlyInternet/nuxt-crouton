<script setup lang="ts">
/**
 * /builder/[pageId] — the PAGE BOARD.
 *
 * Compose a page's layout out of real-collection blocks. This is a REAL route
 * (deep-linkable, browser back returns to `/builder`) — the graduated replacement
 * for the POC's `selectedPageId` v-if swap (spec: `page-site-routing`).
 *
 * Persistence is DURABLE (spec: `board-persistence`): the board's LayoutTree is
 * serialised through `@fyit/crouton-layout`'s canonical `layout-serialize` (spec:
 * `layouttree-serialise`) and round-trips to the `board` json column of the
 * `builderPages` row — survives reload, unlike the POC's in-memory Map.
 *
 * Hooks reproduced here: `page-badge` (this node is "the page") and `floor-readout`
 * (the board's derived floor, folded bottom-up by `deriveSizing`).
 */
import { watchDebounced } from '@vueuse/core'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { deriveSizing } from '@fyit/crouton-layout/app/utils/layout-viability'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))

const { items: pages, pending } = await useCollectionQuery('builderPages')
const page = computed(() => (pages.value as BuilderPage[]).find((p) => p.id === pageId.value) ?? null)

useHead({ title: () => `Builder · ${page.value?.title ?? 'Page'}` })

// A starter arrangement over the REAL collections, so a fresh page opens laid-out
// (not a blank canvas). A persisted board (serialised LayoutTree in `board.layout`)
// wins over this default.
function starterTree(): LayoutTree {
  return {
    renderer: 'panes',
    root: {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', blockId: 'artists-list', config: { collection: 'builderArtists', heading: 'Artists', layout: 'list' } },
        { type: 'leaf', blockId: 'artists-form', config: { collection: 'builderArtists', heading: 'New artist' } },
      ],
    },
  }
}

// Board state — parsed from the durable `board.layout` string, else the starter.
const tree = ref<LayoutTree | null>(null)
watch(
  page,
  (p) => {
    if (!p) return
    const stored = (p.board as Record<string, unknown> | null)?.layout
    tree.value = (typeof stored === 'string' ? parseLayoutTree(stored) : null) ?? starterTree()
  },
  { immediate: true },
)

// Derived floor (folded bottom-up by the package's viability engine) — the
// `floor-readout` hook. Hard floor = widest single leaf; soft = keep-arrangement.
const { blocks } = useCroutonLayoutBlocks()
const derived = computed(() => (tree.value ? deriveSizing(tree.value.root, blocks.value) : null))

// Durable persistence — serialise the tree to the canonical diffable form and
// PATCH it onto the page row. Debounced so a drag doesn't thrash the API.
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
watchDebounced(
  tree,
  async (next) => {
    if (!next || !page.value) return
    saveState.value = 'saving'
    try {
      await update(pageId.value, { board: { layout: serializeLayoutTree(next) } })
      saveState.value = 'saved'
    } catch {
      saveState.value = 'idle'
    }
  },
  { debounce: 700, deep: true },
)
</script>

<template>
  <div class="flex h-[100dvh] flex-col">
    <header class="flex items-center gap-3 border-b border-default px-4 py-2">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        to="/builder"
        aria-label="Back to the site flow"
      >
        Pages
      </UButton>

      <!-- page-badge hook: this board IS "the page" (the live layout). -->
      <UBadge
        v-if="page"
        data-handoff="page-badge"
        color="primary"
        variant="subtle"
        size="sm"
      >
        <UIcon name="i-lucide-star" class="size-3" />
        {{ page.title }}
      </UBadge>

      <!-- floor-readout hook: the board's derived floor. -->
      <span
        v-if="derived"
        data-handoff="floor-readout"
        :data-hard-floor="derived.hardMinWidth"
        :data-soft-floor="derived.softMinWidth"
        class="text-xs text-muted"
      >
        <template v-if="derived.softMinWidth > derived.hardMinWidth">
          stacks &lt;{{ derived.softMinWidth }} · floor {{ derived.hardMinWidth }}px
        </template>
        <template v-else>floor {{ derived.hardMinWidth }}px</template>
      </span>

      <div class="ml-auto flex items-center gap-2 text-xs text-muted">
        <UIcon
          v-if="saveState === 'saving'"
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        <span v-else-if="saveState === 'saved'" class="flex items-center gap-1">
          <UIcon name="i-lucide-check" class="size-4 text-primary" /> Saved
        </span>
      </div>
    </header>

    <div class="relative min-h-0 flex-1">
      <div v-if="pending || !tree" class="flex h-full items-center justify-center text-sm text-muted">
        Loading board…
      </div>
      <!-- The package's editable board: a palette of registered blocks + the pane
           canvas + per-block config + viability badge. v-model = the LayoutTree. -->
      <CroutonLayout v-else v-model="tree" class="h-full" />
    </div>
  </div>
</template>
