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
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { deriveSizing } from '@fyit/crouton-layout/app/utils/layout-viability'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))

// TEMP diagnostic (#988 reload) — remove once the reload cause is confirmed.
// A fresh `iid` each setup: many rapid iids = a remount/navigation loop; one iid
// with repeated seed/edit = a reactivity loop; the tab fully reloading = the log
// clears and a new iid appears per reload. Prefixed so it's easy to filter.
const iid = Math.floor(Math.random() * 1e5).toString(36)
function blog(...a: unknown[]) { if (import.meta.client) console.log(`[board ${iid}]`, ...a) }
blog('setup · pageId=', pageId.value)
onMounted(() => blog('mounted'))
onBeforeUnmount(() => blog('UNMOUNT'))
onErrorCaptured((e) => { blog('errorCaptured', e); return false })

const { items: pages } = await useCollectionQuery('builderPages')
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

// Board state. Seed it ONCE per page (on open / pageId change) — NOT on every
// collection refetch. A save calls update() → invalidateCache refreshes the
// builderPages query → `page` gets a new identity; re-seeding `tree` from that
// would loop (re-seed → save → refetch → re-seed …), which reads as the board
// "constantly reloading". `loadedFor` gates the seed to real page changes.
const tree = ref<LayoutTree | null>(null)
const loadedFor = ref<string | null>(null)
// `ready` gates the loading UI ONCE — after the first seed the board stays
// mounted for good. Never gate it on the query's `pending`: a save refetches the
// builderPages query, `pending` flips, and gating on it would unmount the board to
// "Loading…" and back on every save — the flicker the user sees as "constantly
// reloading" (and the remount re-measures panes → another save → a real loop).
const ready = ref(false)
watch(
  [page, pageId] as const,
  ([p, id]) => {
    blog('seed watch fired · hasPage=', !!p, 'loadedFor=', loadedFor.value, 'id=', id)
    if (!p || loadedFor.value === id) return
    const stored = (p.board as Record<string, unknown> | null)?.layout
    tree.value = (typeof stored === 'string' ? parseLayoutTree(stored) : null) ?? starterTree()
    loadedFor.value = id
    ready.value = true
    blog('seeded tree · ready=true')
  },
  { immediate: true },
)

// Derived floor (folded bottom-up by the package's viability engine) — the
// `floor-readout` hook. Hard floor = widest single leaf; soft = keep-arrangement.
const { blocks } = useCroutonLayoutBlocks()
const derived = computed(() => (tree.value ? deriveSizing(tree.value.root, blocks.value) : null))

// Durable persistence — EXPLICIT, not autosave. Autosave called update() on every
// edit → invalidateCache refetched the builderPages query → cascaded into a
// reload/flicker loop. A manual Save can't auto-fire, so the board is a stable base
// to test on. An edit just marks the board dirty; the Save button commits it.
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
const dirty = ref(false)

function onBoardEdit(next: LayoutTree | null) {
  blog('onBoardEdit (CroutonLayout emitted update:model-value)')
  tree.value = next
  dirty.value = true
  saveState.value = 'idle'
}

async function saveBoard() {
  if (!tree.value) return
  const serialized = serializeLayoutTree(tree.value)
  saveState.value = 'saving'
  try {
    await update(pageId.value, { board: { layout: serialized } })
    dirty.value = false
    saveState.value = 'saved'
  } catch {
    saveState.value = 'idle'
  }
}
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

      <div class="ml-auto flex items-center gap-2">
        <span v-if="saveState === 'saved' && !dirty" class="flex items-center gap-1 text-xs text-muted">
          <UIcon name="i-lucide-check" class="size-4 text-primary" /> Saved
        </span>
        <UButton
          size="sm"
          icon="i-lucide-save"
          :color="dirty ? 'primary' : 'neutral'"
          :variant="dirty ? 'solid' : 'ghost'"
          :loading="saveState === 'saving'"
          :disabled="!dirty && saveState !== 'saving'"
          @click="saveBoard"
        >
          Save
        </UButton>
      </div>
    </header>

    <div class="relative min-h-0 flex-1">
      <div v-if="!ready || !tree" class="flex h-full items-center justify-center text-sm text-muted">
        Loading board…
      </div>
      <!-- The package's editable board: a palette of registered blocks + the pane
           canvas + per-block config + viability badge. Explicit edit handler (not
           v-model) so only genuine edits persist — never the programmatic re-seed. -->
      <CroutonLayout
        v-else
        :model-value="tree"
        class="h-full"
        @update:model-value="onBoardEdit"
      />
    </div>
  </div>
</template>
