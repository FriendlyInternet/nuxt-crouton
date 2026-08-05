<script setup lang="ts">
/**
 * /builder/outline/[pageId] — the OUTLINE editor (spec: `outline-tree-editor`, proposed).
 *
 * SLICE 1 of the DOM-tree direction: edit a page as an OUTLINE of its layout tree instead of a
 * free-floating card canvas. A page's LayoutTree root is shown as a vertical list of its top-level
 * blocks; you TAP a block from a list to add, and DRAG a row (1D insertion line — never the
 * ambiguous 2D drop) to reorder. A live preview renders the real tree beside it. Persists to the
 * same `builderPages.board.layout` the canvas board uses (`serializeLayoutTree`).
 *
 * Deferred to later slices: horizontal drag to nest/unnest, the per-group ⬌/⬍ column toggle,
 * and retiring the canvas board. This slice proves the core: list-to-add + drag-to-reorder + preview.
 */
import { computed, ref, watch, nextTick } from 'vue'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { moveChild, removeNode } from '@fyit/crouton-layout/app/utils/layout-edit'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))
const { items: pages } = await useCollectionQuery('builderPages')
const page = computed(() => (pages.value as BuilderPage[]).find(p => p.id === pageId.value) ?? null)
useHead({ title: () => `Outline · ${page.value?.title ?? 'Page'}` })

// ── The page's layout tree (edited locally; explicit Save persists it). ──────────
const root = ref<LayoutNode | null>(null)
const loadedFor = ref<string | null>(null)
const dirty = ref(false)

function starterRoot(): LayoutNode {
  return {
    type: 'split',
    direction: 'vertical',
    children: [
      { type: 'leaf', blockId: 'artists-list', config: { collection: 'builderArtists', heading: 'Artists', layout: 'list' } },
    ],
  }
}

watch([page, pageId] as const, ([p, id]) => {
  if (!p || loadedFor.value === id) return
  const stored = (p.board as Record<string, unknown> | null)?.layout
  const parsed = typeof stored === 'string' ? parseLayoutTree(stored) : null
  root.value = parsed?.root ?? starterRoot()
  loadedFor.value = id
}, { immediate: true })

// The outline rows = the root split's direct children (a lone leaf/nested root = one row).
const { getBlock } = useCroutonLayoutBlocks()
interface Row { node: LayoutNode, label: string, icon: string, sub: string | null }
function labelFor(node: LayoutNode): { label: string, icon: string, sub: string | null } {
  if (node.type === 'split') {
    const dir = node.direction === 'horizontal' ? 'columns' : 'stack'
    return { label: `Group`, icon: node.direction === 'horizontal' ? 'i-lucide-columns-2' : 'i-lucide-rows-2', sub: `${node.children.length} blocks · ${dir}` }
  }
  if (node.type === 'nested') return { label: node.label ?? 'Nested app', icon: 'i-lucide-box', sub: 'nested layout' }
  const b = getBlock(node.blockId)
  const cfg = node.config as { heading?: string } | undefined
  return { label: b?.name ?? node.blockId, icon: b?.icon ?? 'i-lucide-square', sub: cfg?.heading ?? null }
}
const rows = computed<Row[]>(() => {
  const r = root.value
  if (!r) return []
  const kids = r.type === 'split' ? r.children : [r]
  return kids.map(node => ({ node, ...labelFor(node) }))
})

// ── Add-from-list (tap to insert; appends to the end — the insertion line shows where). ──
const palette = [
  { blockId: 'artists-list', label: 'Artists · List', icon: 'i-lucide-list', collection: 'builderArtists', heading: 'Artists' },
  { blockId: 'artists-form', label: 'Artists · New', icon: 'i-lucide-square-pen', collection: 'builderArtists', heading: 'New artist' },
  { blockId: 'artists-stats', label: 'Artists · Stats', icon: 'i-lucide-gauge', collection: 'builderArtists', heading: 'Artists' },
  { blockId: 'bookings-list', label: 'Bookings · List', icon: 'i-lucide-list', collection: 'builderBookings', heading: 'Bookings' },
  { blockId: 'spacer', label: 'Spacer', icon: 'i-lucide-square-dashed' },
]
type PaletteItem = (typeof palette)[number]

function addBlock(item: PaletteItem) {
  const leaf: LayoutNode = {
    type: 'leaf',
    blockId: item.blockId,
    config: item.collection ? { collection: item.collection, heading: item.heading } : {},
  }
  const r = root.value
  if (!r) root.value = leaf
  else if (r.type === 'split') root.value = { ...r, children: [...r.children, leaf] }
  else root.value = { type: 'split', direction: 'vertical', children: [r, leaf] }
  dirty.value = true
}

function removeRow(index: number) {
  const r = root.value
  if (!r) return
  if (r.type !== 'split') { root.value = null; dirty.value = true; return }
  root.value = removeNode(r, [index]) ?? null
  dirty.value = true
}

// ── Pointer drag-to-reorder — the 1D insertion line (no ambiguous 2D drop). ──────
const listEl = ref<HTMLElement | null>(null)
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null) // insertion slot (0..rows.length)

function onHandleDown(index: number, e: PointerEvent) {
  dragIndex.value = index
  dropIndex.value = index
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}
function onMove(e: PointerEvent) {
  const el = listEl.value
  if (el == null || dragIndex.value == null) return
  const rowEls = Array.from(el.querySelectorAll<HTMLElement>('[data-row]'))
  let slot = rowEls.length
  for (let i = 0; i < rowEls.length; i++) {
    const rect = rowEls[i]!.getBoundingClientRect()
    if (e.clientY < rect.top + rect.height / 2) { slot = i; break }
  }
  dropIndex.value = slot
}
function onUp() {
  window.removeEventListener('pointermove', onMove)
  const from = dragIndex.value
  let to = dropIndex.value
  dragIndex.value = null
  dropIndex.value = null
  if (from == null || to == null) return
  // A drop slot AFTER the dragged row collapses by one once the row is removed.
  if (to > from) to -= 1
  if (to === from) return
  const r = root.value
  if (r?.type === 'split') { root.value = moveChild(r, [], from, to); dirty.value = true }
}

// ── Save (explicit, mirrors the canvas board). ──────────────────────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function save() {
  if (!root.value) return
  const tree: LayoutTree = { renderer: 'panes', root: root.value }
  saveState.value = 'saving'
  try {
    await update(pageId.value, { board: { layout: serializeLayoutTree(tree) } })
    dirty.value = false
    saveState.value = 'saved'
  } catch { saveState.value = 'idle' }
}
</script>

<template>
  <div class="flex h-[100dvh] flex-col bg-default text-default">
    <!-- header -->
    <header class="flex items-center gap-2 border-b border-default px-3 py-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" to="/builder" aria-label="Back to pages" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold">{{ page?.title ?? 'Page' }}</div>
        <div class="text-[11px] text-muted">Outline · <span class="text-primary">beta</span></div>
      </div>
      <UButton
        :icon="dirty ? 'i-lucide-save' : 'i-lucide-check'"
        :color="dirty ? 'primary' : 'neutral'"
        :variant="dirty ? 'solid' : 'ghost'"
        size="sm"
        :loading="saveState === 'saving'"
        :disabled="!dirty && saveState !== 'saving'"
        @click="save"
      >
        {{ saveState === 'saved' && !dirty ? 'Saved' : 'Save' }}
      </UButton>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <!-- the outline -->
      <section>
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Page outline</div>
        <div ref="listEl" data-handoff="outline-list" class="flex flex-col">
          <template v-for="(row, i) in rows" :key="i">
            <!-- insertion line -->
            <div
              v-if="dropIndex === i && dragIndex !== null"
              class="mx-1 my-0.5 h-0.5 rounded-full bg-primary"
              data-handoff="insertion-line"
            />
            <div
              data-row
              data-handoff="outline-row"
              class="flex items-center gap-2 rounded-lg border border-default bg-elevated/40 px-2 py-2 transition"
              :class="dragIndex === i ? 'opacity-40 ring-1 ring-primary' : ''"
            >
              <div
                class="nodrag flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:bg-elevated"
                data-handoff="row-handle"
                aria-label="Drag to reorder"
                @pointerdown="onHandleDown(i, $event)"
              >
                <UIcon name="i-lucide-grip-vertical" class="size-4" />
              </div>
              <UIcon :name="row.icon" class="size-4 shrink-0 text-primary" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ row.label }}</div>
                <div v-if="row.sub" class="truncate text-[11px] text-muted">{{ row.sub }}</div>
              </div>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Remove block"
                @click="removeRow(i)"
              />
            </div>
          </template>
          <!-- trailing insertion line -->
          <div
            v-if="dropIndex === rows.length && dragIndex !== null"
            class="mx-1 my-0.5 h-0.5 rounded-full bg-primary"
            data-handoff="insertion-line"
          />
          <p v-if="!rows.length" class="rounded-lg border border-dashed border-default px-3 py-6 text-center text-sm text-muted">
            Empty page — add a block below.
          </p>
        </div>
      </section>

      <!-- add-from-list -->
      <section>
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Add a block</div>
        <div class="flex flex-wrap gap-1.5" data-handoff="add-list">
          <UButton
            v-for="item in palette"
            :key="item.blockId"
            :icon="item.icon"
            color="neutral"
            variant="soft"
            size="sm"
            data-handoff="add-item"
            @click="addBlock(item)"
          >
            {{ item.label }}
          </UButton>
        </div>
      </section>

      <!-- live preview -->
      <section class="min-h-0 flex-1">
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Live preview</div>
        <div class="overflow-hidden rounded-xl border border-default bg-elevated/30" data-handoff="outline-preview">
          <CroutonLayoutRenderer v-if="root" :node="root" :interactive="false" />
        </div>
      </section>
    </div>
  </div>
</template>
