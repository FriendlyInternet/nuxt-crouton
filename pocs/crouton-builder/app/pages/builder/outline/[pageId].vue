<script setup lang="ts">
/**
 * /builder/outline/[pageId] — the OUTLINE editor (spec: `outline-tree-editor`, proposed).
 *
 * SLICE 2 — outline + responsive, combined in ONE surface (no separate "Breakpoints" mode).
 *  · list-to-add + drag-to-reorder + live preview   (slice 1)
 *  · a DEVICE/WIDTH bar (Phone/Tablet/Desktop): the outline + preview RESOLVE at that width
 *    via the engine's `resolveLayoutAtWidth`, so you see the page as it looks on that device.
 *  · a page DIRECTION toggle (⬌ columns / ⬍ stack) — the responsive dial that matters most.
 *  · AUTHOR-AT-WIDTH: an edit at the base (narrowest) width edits `tree.root`; an edit at a
 *    wider device authors a breakpoint there (`patchBreakpoint`, min-width-locks-upward). So
 *    "columns on Desktop, stack on Phone" is just something you demonstrate at each width.
 *
 * Persists the whole tree (incl. breakpoints) to `builderPages.board.layout`. Deferred to a
 * later slice: horizontal drag to nest/unnest, per-group toggles, retiring the canvas.
 */
import { computed, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { moveChild, removeNode } from '@fyit/crouton-layout/app/utils/layout-edit'
import { resolveLayoutAtWidth, patchBreakpoint } from '@fyit/crouton-layout/app/utils/layout-responsive'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))
const { items: pages } = await useCollectionQuery('builderPages')
const page = computed(() => (pages.value as BuilderPage[]).find(p => p.id === pageId.value) ?? null)
useHead({ title: () => `Outline · ${page.value?.title ?? 'Page'}` })

// ── The page's whole layout tree (root + authored breakpoints). ──────────────────
const tree = ref<LayoutTree>({ renderer: 'panes', root: starterRoot() })
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
  tree.value = parsed ?? { renderer: 'panes', root: starterRoot() }
  loadedFor.value = id
}, { immediate: true })

// ── Device / width bar — the outline + preview resolve at the selected width. ─────
const DEVICES = [
  { key: 'phone', label: 'Phone', icon: 'i-lucide-smartphone', width: 390 },
  { key: 'tablet', label: 'Tablet', icon: 'i-lucide-tablet-smartphone', width: 768 },
  { key: 'desktop', label: 'Desktop', icon: 'i-lucide-monitor', width: 1200 },
] as const
const deviceKey = ref<(typeof DEVICES)[number]['key']>('phone')
const device = computed(() => DEVICES.find(d => d.key === deviceKey.value)!)

// The effective layout AT this width (base + any authored breakpoints, largest-active-wins).
const resolved = computed(() => resolveLayoutAtWidth(tree.value, device.value.width))
// `activeBreakpoint === null` ⇒ we're on the BASE layer (edits go to tree.root); else the
// device's width is a breakpoint layer (edits author/patch a full-root override there).
const atBase = computed(() => resolved.value.activeBreakpoint === null)
const bpCount = computed(() => tree.value.breakpoints?.length ?? 0)

// Every structural edit routes through here: mutate the resolved root, then write it to the
// right layer for the current width (base vs a per-width breakpoint override).
function editRoot(mutate: (root: LayoutNode) => LayoutNode | null) {
  const next = mutate(resolved.value.root) ?? starterRoot()
  if (atBase.value) tree.value = { ...tree.value, root: next }
  else tree.value = patchBreakpoint(tree.value, device.value.width, { root: next, label: device.value.label })
  dirty.value = true
}

// ── Page direction (⬌ columns / ⬍ stack) — the responsive dial, authored at this width. ──
const pageDir = computed(() => (resolved.value.root.type === 'split' ? resolved.value.root.direction : null))
function setPageDir(dir: 'horizontal' | 'vertical') {
  editRoot(root => (root.type === 'split' ? { ...root, direction: dir } : root))
}

// ── Outline rows = the resolved root's direct children. ──────────────────────────
const { getBlock } = useCroutonLayoutBlocks()
interface Row { node: LayoutNode, label: string, icon: string, sub: string | null }
function labelFor(node: LayoutNode): Omit<Row, 'node'> {
  if (node.type === 'split') {
    const dir = node.direction === 'horizontal' ? 'columns' : 'stack'
    return { label: 'Group', icon: node.direction === 'horizontal' ? 'i-lucide-columns-2' : 'i-lucide-rows-2', sub: `${node.children.length} blocks · ${dir}` }
  }
  if (node.type === 'nested') return { label: node.label ?? 'Nested app', icon: 'i-lucide-box', sub: 'nested layout' }
  const b = getBlock(node.blockId)
  const cfg = node.config as { heading?: string } | undefined
  return { label: b?.name ?? node.blockId, icon: b?.icon ?? 'i-lucide-square', sub: cfg?.heading ?? null }
}
const rows = computed<Row[]>(() => {
  const r = resolved.value.root
  const kids = r.type === 'split' ? r.children : [r]
  return kids.map(node => ({ node, ...labelFor(node) }))
})

// ── Add-from-list (tap to insert; appends at this width's layer). ─────────────────
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
  editRoot(root => (root.type === 'split' ? { ...root, children: [...root.children, leaf] } : { type: 'split', direction: 'vertical', children: [root, leaf] }))
}
function removeRow(index: number) {
  editRoot(root => (root.type === 'split' ? removeNode(root, [index]) : null))
}

// ── Pointer drag-to-reorder — the 1D insertion line. ─────────────────────────────
const listEl = ref<HTMLElement | null>(null)
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
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
  if (to > from) to -= 1
  if (to === from) return
  editRoot(root => (root.type === 'split' ? moveChild(root, [], from, to) : root))
}

// ── Scaled device preview (zoom to fit the phone screen). ────────────────────────
const previewWrap = ref<HTMLElement | null>(null)
const { width: availW } = useElementSize(previewWrap)
const previewScale = computed(() => Math.min(1, (availW.value || 340) / device.value.width))

// ── Save (explicit; persists the whole tree incl. breakpoints). ──────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function save() {
  saveState.value = 'saving'
  try {
    await update(pageId.value, { board: { layout: serializeLayoutTree(tree.value) } })
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

    <!-- device / width bar -->
    <div class="flex items-center gap-2 border-b border-default px-3 py-2" data-handoff="device-bar">
      <div class="flex rounded-lg bg-elevated/50 p-0.5">
        <button
          v-for="d in DEVICES"
          :key="d.key"
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition"
          :class="deviceKey === d.key ? 'bg-primary text-inverted shadow' : 'text-muted hover:text-default'"
          :data-handoff="`device-${d.key}`"
          @click="deviceKey = d.key"
        >
          <UIcon :name="d.icon" class="size-4" />
          {{ d.label }}
        </button>
      </div>
      <span class="ml-auto text-[11px]" data-handoff="editing-layer">
        <template v-if="atBase">editing <span class="font-semibold text-default">base</span> · all widths</template>
        <template v-else>editing <span class="font-semibold text-primary">{{ device.label }}</span> & up</template>
      </span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <!-- page direction (the responsive dial) -->
      <section v-if="pageDir">
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Page layout <span class="normal-case text-muted/70">· on {{ atBase ? 'all widths' : device.label + ' & up' }}</span>
        </div>
        <div class="flex rounded-lg border border-default p-0.5" data-handoff="page-direction">
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition"
            :class="pageDir === 'vertical' ? 'bg-primary text-inverted' : 'text-muted hover:text-default'"
            data-handoff="dir-stack"
            @click="setPageDir('vertical')"
          >
            <UIcon name="i-lucide-rows-2" class="size-4" /> Stack
          </button>
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition"
            :class="pageDir === 'horizontal' ? 'bg-primary text-inverted' : 'text-muted hover:text-default'"
            data-handoff="dir-columns"
            @click="setPageDir('horizontal')"
          >
            <UIcon name="i-lucide-columns-2" class="size-4" /> Columns
          </button>
        </div>
      </section>

      <!-- the outline -->
      <section>
        <div class="mb-1.5 flex items-center gap-2 px-1">
          <span class="text-[11px] font-semibold uppercase tracking-wide text-muted">Page outline</span>
          <UBadge v-if="bpCount" color="primary" variant="subtle" size="xs" data-handoff="bp-count">
            {{ bpCount }} breakpoint{{ bpCount > 1 ? 's' : '' }}
          </UBadge>
        </div>
        <div ref="listEl" data-handoff="outline-list" class="flex flex-col">
          <template v-for="(row, i) in rows" :key="i">
            <div v-if="dropIndex === i && dragIndex !== null" class="mx-1 my-0.5 h-0.5 rounded-full bg-primary" data-handoff="insertion-line" />
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
              <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs" aria-label="Remove block" @click="removeRow(i)" />
            </div>
          </template>
          <div v-if="dropIndex === rows.length && dragIndex !== null" class="mx-1 my-0.5 h-0.5 rounded-full bg-primary" data-handoff="insertion-line" />
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

      <!-- live preview at the selected device width -->
      <section class="min-h-0 flex-1">
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Live preview <span class="normal-case text-muted/70">· {{ device.label }} ({{ device.width }}px)</span>
        </div>
        <div ref="previewWrap" class="overflow-hidden rounded-xl border border-default bg-elevated/30 p-2" data-handoff="outline-preview">
          <div :style="{ width: device.width + 'px', zoom: previewScale }" class="mx-auto overflow-hidden rounded-lg border border-default/60 bg-default">
            <CroutonLayoutRenderer :node="resolved.root" :interactive="false" />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
