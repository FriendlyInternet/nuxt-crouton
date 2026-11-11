// @vitest-environment happy-dom
/**
 * #3746 — editor and preview give each pane the same width.
 *
 * Both sides are the REAL components: the board is `BoardTree` on reka's splitter (the
 * editor Builder ships), the preview is the package's view-mode `LayoutRenderer` (what a
 * served page / Preview renders). Only the pane-width read-out differs, because happy-dom
 * has no layout engine:
 *  - board: reka publishes each panel's size on `data-panel-size` (%), and the panels
 *    share the group width minus the 6px handles;
 *  - preview: the renderer's own inline styles (flex-grow, `min-width: min(Npx, 100%)`,
 *    `--stack-at`) are resolved with the browser's flex algorithm (`resolveFlexRow`) —
 *    free space by flex-grow, a pane under its min-width frozen at it, repeat.
 * `useElementSize` is pinned to the frame width (536px, the owner's "Fit" screenshot).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
// The package's exports don't list its .vue files; import the real source by path.
import LayoutRenderer from '../../../packages/crouton-layout/app/components/LayoutRenderer.vue'
import BoardTree from '../app/components/board/BoardTree.vue'

const frameWidth = ref(536)
vi.mock('@vueuse/core', async (orig) => ({
  ...(await orig<typeof import('@vueuse/core')>()),
  useElementSize: () => ({ width: frameWidth, height: ref(600) }),
}))

const registry = {
  'artists-stats': { id: 'artists-stats', name: 's', description: '', icon: '', component: 'TestBlock', minWidth: 200 },
  'artists-list': { id: 'artists-list', name: 'l', description: '', icon: '', component: 'TestBlock', minWidth: 260 },
  'artists-form': { id: 'artists-form', name: 'f', description: '', icon: '', component: 'TestBlock', minWidth: 320 },
  'narrow': { id: 'narrow', name: 'n', description: '', icon: '', component: 'TestBlock', minWidth: 60 },
} as any

const leaf = (blockId: string, defaultSize?: number): LayoutNode =>
  ({ type: 'leaf', blockId, ...(defaultSize != null ? { defaultSize } : {}) } as any)
const row = (children: LayoutNode[]): LayoutSplit => ({ type: 'split', direction: 'horizontal', children } as any)

const BOARD_HANDLE = 6
const PREVIEW_GAP = 1

beforeEach(() => {
  frameWidth.value = 536
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useCroutonLayoutBlocks', () => ({
    blocks: ref(registry),
    resolveComponentName: (id: string) => registry[id]?.component ?? null,
    sanitizeConfig: () => ({}),
  }))
})
afterEach(() => vi.unstubAllGlobals())

const BoardPaneStub = defineComponent({ props: ['node'], render() { return h('div', { 'data-pane': (this as any).node.blockId }) } })

function mountBoard(node: LayoutNode) {
  return mount(BoardTree, {
    props: { node },
    attachTo: document.body,
    global: { components: { BoardTree, BoardPane: BoardPaneStub } },
  })
}

function mountPreview(node: LayoutNode) {
  return mount(LayoutRenderer, {
    props: { node, interactive: false },
    global: {
      components: {
        CroutonLayoutRenderer: LayoutRenderer,
        CroutonLayoutCollapseHandle: defineComponent({ render: () => null }),
        TestBlock: defineComponent({ render: () => h('div') }),
      },
    },
  })
}

/** Board pane widths (px) of the top-level group: reka's sizes over the group width minus handles. */
function boardWidths(w: ReturnType<typeof mountBoard>, width = frameWidth.value): number[] {
  // the top-level group is the first one in document order
  const panels = w.find('[data-panel-group]').element.querySelectorAll(':scope > [data-panel]')
  const free = width - BOARD_HANDLE * (panels.length - 1)
  return Array.from(panels).map(p => (Number(p.getAttribute('data-panel-size')) / 100) * free)
}

/** Resolve the preview's rendered flex row at `width` the way a browser does. */
function resolveFlexRow(w: ReturnType<typeof mountPreview>, width = frameWidth.value): { stacked: boolean, widths: number[] } {
  const grid = w.find('.croutonviewgrid').element as HTMLElement
  const stackAt = Number.parseFloat(grid.style.getPropertyValue('--stack-at'))
  const panes = Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-crouton-pane]'))
  // flex-basis `(var(--stack-at) - 100%) * 999`: at or below the threshold every pane takes a full row.
  if (width <= stackAt) return { stacked: true, widths: panes.map(() => width) }
  const grow = panes.map(p => Number(p.style.flexGrow))
  const floor = panes.map((p) => {
    const m = /min\((\d+(?:\.\d+)?)px/.exec(p.style.minWidth)
    return Math.min(m ? Number(m[1]) : 0, width)
  })
  const free = width - PREVIEW_GAP * (panes.length - 1)
  const frozen: (number | null)[] = panes.map(() => null)
  for (;;) {
    const open = frozen.map((f, i) => (f == null ? i : -1)).filter(i => i >= 0)
    const left = free - frozen.reduce<number>((s, f) => s + (f ?? 0), 0)
    const g = open.reduce((s, i) => s + grow[i]!, 0)
    const tentative = open.map(i => ({ i, px: (left * grow[i]!) / g }))
    const violators = tentative.filter(t => t.px < floor[t.i]!)
    if (violators.length === 0) {
      tentative.forEach(t => (frozen[t.i] = t.px))
      return { stacked: false, widths: frozen as number[] }
    }
    violators.forEach(t => (frozen[t.i] = floor[t.i]!))
  }
}

const within2pct = (a: number[], b: number[], width = frameWidth.value) =>
  a.forEach((px, i) => expect(Math.abs(px - b[i]!) / width * 100).toBeLessThanOrEqual(2))

describe('editor (BoardTree) vs preview (LayoutRenderer) at 536px (#3746)', () => {
  it('1 · same [80, 20] split renders the same pane widths (±2%) and the list keeps its 260px', async () => {
    const node = row([leaf('artists-stats', 80), leaf('artists-list', 20)])
    const board = mountBoard(node)
    await nextTick()
    const preview = resolveFlexRow(mountPreview(node))
    expect(preview.stacked).toBe(false)
    const b = boardWidths(board)
    within2pct(b, preview.widths)
    expect(b[1]!).toBeGreaterThanOrEqual(260 - 0.5)
    expect(preview.widths[1]!).toBeGreaterThanOrEqual(260)
  })

  it('1b · the owner\'s top row [stats 20, form 80] matches too (stats floored at 200px)', async () => {
    const node = row([leaf('artists-stats', 20), leaf('artists-form', 80)])
    const board = mountBoard(node)
    await nextTick() // reka's first layout pass (the clamp)
    const b = boardWidths(board)
    within2pct(b, resolveFlexRow(mountPreview(node)).widths)
    expect(b[0]!).toBeGreaterThanOrEqual(200 - 0.5)
  })

  it('1c · a nested split pane gets the same width on both sides', async () => {
    // inner row [narrow, narrow]: soft floor 120, hard floor 60 — the two sides must not disagree.
    const node = row([leaf('artists-list', 85), row([leaf('narrow'), leaf('narrow')]) as any])
    ;(node.children[1] as any).defaultSize = 15
    const board = mountBoard(node)
    await nextTick()
    const b = boardWidths(board)
    within2pct(b, resolveFlexRow(mountPreview(node)).widths)
  })

  it('2 · a stored size below the minimum opens at the minimum — measured after first paint, without marking the page edited', async () => {
    frameWidth.value = 0 // not measured yet (first paint)
    const board = mountBoard(row([leaf('artists-stats', 80), leaf('artists-list', 20)]))
    await nextTick()
    frameWidth.value = 536
    await nextTick()
    await nextTick()
    const b = boardWidths(board)
    expect(b[1]!).toBeGreaterThanOrEqual(260 - 0.5)
    // reka's clamp on open must not edit the page (no `resize` → not unsaved)
    expect(board.emitted('resize')).toBeFalsy()
  })

  it('3 · dragging the divider (keyboard) can\'t take a pane below its minimum, and does edit the page', async () => {
    const board = mountBoard(row([leaf('artists-stats', 50), leaf('artists-list', 50)]))
    await nextTick()
    const handle = board.find('[data-handoff="pane-resize-handle"]').element as HTMLElement
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    await nextTick()
    const b = boardWidths(board)
    expect(b[1]!).toBeGreaterThanOrEqual(260 - 0.5)
    const resizes = board.emitted('resize') as [unknown, number[]][] | undefined
    expect(resizes?.length).toBeGreaterThan(0)
    const sizes = resizes!.at(-1)![1]
    expect((sizes[1]! / 100) * (536 - BOARD_HANDLE)).toBeGreaterThanOrEqual(260 - 0.5)
  })

  it('4 · a row whose minimums exceed the width stacks on both sides', async () => {
    const node = row([leaf('artists-stats'), leaf('artists-form'), leaf('artists-list')]) // 780 > 536
    const board = mountBoard(node)
    await nextTick()
    expect(board.find('[data-handoff="board-stack"]').exists()).toBe(true)
    expect(board.find('[data-panel-group]').exists()).toBe(false)
    expect(resolveFlexRow(mountPreview(node)).stacked).toBe(true)
  })
})
