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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { computed, defineComponent, h, inject, nextTick, ref, type Component } from 'vue'
import { mount } from '@vue/test-utils'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
// The package's exports don't list its .vue files; import the real source by path.
import LayoutRenderer from '../../../packages/crouton-layout/app/components/LayoutRenderer.vue'
import BoardTree from '../app/components/board/BoardTree.vue'
import { pageRowTracks } from '../../../packages/crouton-layout/app/utils/layout-viability'
import { partitionCollapsed } from '../../../packages/crouton-layout/app/utils/layout-responsive'
import { LAYOUT_RENDER_CONTEXT_KEY } from '../../../packages/crouton-layout/app/composables/useCroutonLayoutRenderContext'
import { expandGroups } from '../app/utils/board-groups'

const frameWidth = ref(536)
vi.mock('@vueuse/core', async (orig) => ({
  ...(await orig<typeof import('@vueuse/core')>()),
  useElementSize: () => ({ width: frameWidth, height: ref(600) }),
}))

const registry = {
  // minHeight / sizing mirror step 1's real values (app.config.ts, #3815).
  'artists-stats': { id: 'artists-stats', name: 's', description: '', icon: '', component: 'TestBlock', minWidth: 200, minHeight: 96, sizing: { width: 'fill', height: 'hug' } },
  'artists-list': { id: 'artists-list', name: 'l', description: '', icon: '', component: 'TestBlock', minWidth: 260, minHeight: 240, sizing: { width: 'fill', height: 'fill' } },
  'artists-form': { id: 'artists-form', name: 'f', description: '', icon: '', component: 'TestBlock', minWidth: 320 },
  'narrow': { id: 'narrow', name: 'n', description: '', icon: '', component: 'TestBlock', minWidth: 60 },
} as any

const leaf = (blockId: string, defaultSize?: number): LayoutNode =>
  ({ type: 'leaf', blockId, ...(defaultSize != null ? { defaultSize } : {}) } as any)
const row = (children: LayoutNode[]): LayoutSplit => ({ type: 'split', direction: 'horizontal', children } as any)
const col = (children: LayoutNode[]): LayoutSplit => ({ type: 'split', direction: 'vertical', children } as any)

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
const BoardGroupHandleStub = defineComponent({ render: () => null })

function mountBoard(node: LayoutNode, hidden?: string[]) {
  return mount(BoardTree, {
    props: { node, ...(hidden ? { hidden: new Set(hidden) } : {}) },
    attachTo: document.body,
    global: { components: { BoardTree, BoardPane: BoardPaneStub, BoardGroupHandle: BoardGroupHandleStub } },
  })
}

// A block that shows which render context its pane provides (#3865 test 5).
const TestBlock = defineComponent({
  setup() {
    const ctx = inject(LAYOUT_RENDER_CONTEXT_KEY, null)
    return () => h('div', { 'data-ctx': ctx?.value ?? 'none' })
  },
})
const rendererComponents = {
  CroutonLayoutRenderer: LayoutRenderer,
  CroutonLayoutCollapseHandle: defineComponent({ render: () => null }),
  TestBlock,
}

function mountPreview(node: LayoutNode) {
  return mount(LayoutRenderer, {
    props: { node, interactive: false },
    global: { components: rendererComponents },
  })
}

// The REAL BoardPane (tests 5/5b): it imports `~/utils/board-drag`, which calls the
// auto-imported `ref` at module load — so set the globals first, then import it.
let RealBoardPane: Component
let RealBoardGroupHandle: Component
beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).ref = ref
  ;(globalThis as Record<string, unknown>).computed = computed
  RealBoardPane = (await import('../app/components/board/BoardPane.vue')).default
  RealBoardGroupHandle = (await import('../app/components/board/BoardGroupHandle.vue')).default
})
function mountBoardReal(node: LayoutNode, hidden?: string[]) {
  return mount(BoardTree, {
    props: { node, ...(hidden ? { hidden: new Set(hidden) } : {}) },
    attachTo: document.body,
    global: {
      components: { BoardTree, BoardPane: RealBoardPane, BoardGroupHandle: RealBoardGroupHandle, ...rendererComponents, UIcon: defineComponent({ render: () => h('i') }) },
    },
  })
}

const boardGrids = (w: ReturnType<typeof mountBoard>) =>
  Array.from(w.element.ownerDocument!.querySelectorAll<HTMLElement>('[data-handoff="board-grid"]'))
    .filter(el => w.element === el || w.element.contains(el))
const previewGrids = (w: ReturnType<typeof mountPreview>) =>
  [w.element as HTMLElement, ...Array.from((w.element as HTMLElement).querySelectorAll<HTMLElement>('.croutonviewgrid'))]
    .filter(el => el.classList?.contains('croutonviewgrid'))

/** Board pane widths (px) of the top-level group: reka's sizes over the group width minus handles. */
function boardWidths(w: ReturnType<typeof mountBoard>, width = frameWidth.value): number[] {
  // the top-level group is the first one in document order
  const panels = w.find('[data-panel-group]').element.querySelectorAll(':scope > [data-panel]')
  const free = width - BOARD_HANDLE * (panels.length - 1)
  return Array.from(panels).map(p => (Number(p.getAttribute('data-panel-size')) / 100) * free)
}

/** Resolve the preview's rendered flex row at `width` the way a browser does. */
function resolveFlexRow(w: ReturnType<typeof mountPreview>, width = frameWidth.value, el?: HTMLElement): { stacked: boolean, widths: number[] } {
  const grid = el ?? (w.find('.croutonviewgrid').element as HTMLElement)
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

// #3865 — the board draws the page's rows: same row tracks, the same top alignment of
// side-by-side panes, the same block-minimum floors. happy-dom has no layout engine, so
// these compare styles, classes and attributes, never measured boxes.
describe('editor rows flow like the page (#3865)', () => {
  it('1 · vertical [Stats (Fit), List (Fill)]: same row tracks, no min-height on the board grid, no row handle', async () => {
    const node = col([leaf('artists-stats'), leaf('artists-list')])
    const board = mountBoard(node)
    await nextTick()
    const preview = previewGrids(mountPreview(node))[0]!
    const grid = boardGrids(board)[0]
    expect(grid).toBeTruthy()
    expect(preview.style.gridTemplateRows).toBe('auto minmax(240px, auto)')
    expect(grid!.style.gridTemplateRows).toBe(preview.style.gridTemplateRows)
    expect(grid!.style.minHeight).toBe('')
    expect(board.findAll('[data-handoff="pane-resize-handle"]')).toHaveLength(0)
    expect(board.emitted('resize')).toBeFalsy()
  })

  it('2 · the owner\'s case [[Stats | Form], [Stats | List]]: same row tracks and the same pane widths', async () => {
    const top = row([leaf('artists-stats', 20), leaf('artists-form', 80)])
    const bottom = row([leaf('artists-stats', 50), leaf('artists-list', 50)])
    const node = col([top, bottom])
    const board = mountBoard(node)
    await nextTick()
    const preview = mountPreview(node)
    const [outer, ...rows] = previewGrids(preview)
    expect(boardGrids(board)[0]!.style.gridTemplateRows).toBe(outer!.style.gridTemplateRows)
    expect(outer!.style.gridTemplateRows).toBe('minmax(96px, auto) minmax(240px, auto)')
    const groups = board.findAll('[data-panel-group]')
    expect(groups).toHaveLength(2)
    rows.forEach((r, gi) => {
      const panels = groups[gi]!.element.querySelectorAll(':scope > [data-panel]')
      const free = frameWidth.value - BOARD_HANDLE * (panels.length - 1)
      const b = Array.from(panels).map(p => (Number(p.getAttribute('data-panel-size')) / 100) * free)
      within2pct(b, resolveFlexRow(preview, frameWidth.value, r).widths)
    })
  })

  it('3 · hidden panes: [Stats, [Form (hidden) | Stats]] — tracks match the page\'s visible tree; a one-visible split draws its child alone', async () => {
    const node = col([leaf('artists-stats'), row([leaf('artists-form'), leaf('artists-stats')])])
    const board = mountBoard(node, ['artists-form'])
    await nextTick()
    const visible = partitionCollapsed(node, ['artists-form']).visible!
    const previewW = mountPreview(visible)
    const preview = previewGrids(previewW)
    expect(preview).toHaveLength(1)
    const grid = boardGrids(board)[0]!
    expect(grid.style.gridTemplateRows).toBe(preview[0]!.style.gridTemplateRows)
    expect(grid.style.gridTemplateRows).toBe(pageRowTracks((visible as LayoutSplit).children, registry))
    // the [Form | Stats] split draws Stats alone: no reka group, two panes in all
    expect(board.find('[data-panel-group]').exists()).toBe(false)
    expect(board.findAll('[data-pane]').map(p => p.attributes('data-pane'))).toEqual(['artists-stats', 'artists-stats'])
    expect(previewW.findAll('[data-ctx]')).toHaveLength(2)
  })

  it('4 · side-by-side [List | Stats]: top-aligned on both sides, handle spans the row, panes floored at the same min-height', async () => {
    const node = row([leaf('artists-list'), leaf('artists-stats')])
    const board = mountBoard(node)
    await nextTick()
    const preview = previewGrids(mountPreview(node))[0]!
    expect(preview.style.alignItems).toBe('flex-start')
    expect(preview.style.alignContent).toBe('flex-start')
    const group = board.find('[data-panel-group]')
    expect(group.classes()).toEqual(expect.arrayContaining(['!h-auto', '!items-start']))
    expect(board.find('[data-handoff="pane-resize-handle"]').classes()).toContain('self-stretch')
    const boardMins = Array.from(group.element.querySelectorAll<HTMLElement>(':scope > [data-panel]'))
      .map(p => (p.firstElementChild as HTMLElement).style.minHeight)
    const previewMins = Array.from(preview.querySelectorAll<HTMLElement>(':scope > [data-crouton-pane]')).map(p => p.style.minHeight)
    expect(previewMins).toEqual(['240px', '96px'])
    expect(boardMins).toEqual(previewMins)
  })

  it('4b · stacked at 390px [Stats | Form]: block-minimum floors instead of min-h-72, no inner scroll', async () => {
    frameWidth.value = 390
    const node = row([leaf('artists-stats', 20), leaf('artists-form', 80)])
    const board = mountBoard(node)
    await nextTick()
    const previewW = mountPreview(node)
    expect(resolveFlexRow(previewW).stacked).toBe(true)
    const stack = board.find('[data-handoff="board-stack"]')
    expect(stack.exists()).toBe(true)
    expect(stack.classes()).not.toContain('overflow-y-auto')
    expect(stack.classes()).not.toContain('h-full')
    const panes = Array.from(stack.element.querySelectorAll<HTMLElement>(':scope > div'))
    panes.forEach(p => expect(p.classList.contains('min-h-72')).toBe(false))
    const previewMins = Array.from(previewGrids(previewW)[0]!.querySelectorAll<HTMLElement>(':scope > [data-crouton-pane]')).map(p => p.style.minHeight)
    expect(previewMins[0]).toBe('96px')
    expect(panes.map(p => p.style.minHeight)).toEqual(previewMins)
  })

  it('5 · a board leaf renders in the page context; BoardPane is content-height at the top and fills a grid cell', async () => {
    const top = mountBoardReal(leaf('artists-list'))
    await nextTick()
    expect(top.find('[data-ctx]').attributes('data-ctx')).toBe('page')
    const topPane = top.find('[data-handoff="board-pane"]')
    expect(topPane.classes()).not.toContain('h-full')
    expect(topPane.classes()).not.toContain('min-h-full')

    // [Stats, [List | Stats]] — the grid's direct panes fill their cells; the row's wrapper sits in a cell.
    const grid = mountBoardReal(col([leaf('artists-stats'), row([leaf('artists-list'), leaf('artists-stats')])]))
    await nextTick()
    const root = grid.find('[data-handoff="board-split"]')
    expect(root.classes()).not.toContain('h-full')
    const cells = grid.findAll('[data-handoff="board-cell"]')
    expect(cells[0]!.find('[data-handoff="board-pane"]').classes()).toContain('min-h-full')
    expect(cells[1]!.find('[data-handoff="board-split"]').classes()).toContain('h-full')
    // panes in a side-by-side row are not grid cells
    cells[1]!.findAll('[data-handoff="board-pane"]').forEach(p => expect(p.classes()).not.toContain('min-h-full'))

    // a split inside a side-by-side panel is not in a grid cell → no h-full
    const nested = mountBoardReal(row([leaf('artists-list'), col([leaf('artists-stats'), leaf('artists-list')])]))
    await nextTick()
    const splits = nested.findAll('[data-handoff="board-split"]')
    expect(splits).toHaveLength(2)
    splits.forEach(s => expect(s.classes()).not.toContain('h-full'))
  })

  it('5b · grid cells size like the page\'s; a nested vertical grid fills its cell; the collapsed shape keeps h-full down to it', async () => {
    const node = col([leaf('artists-stats'), col([leaf('artists-list'), leaf('artists-stats')])])
    const board = mountBoardReal(node)
    await nextTick()
    const preview = mountPreview(node)
    const cell = board.find('[data-handoff="board-cell"]')
    expect(cell.classes()).toEqual(expect.arrayContaining(['min-w-0', 'overflow-hidden']))
    expect(preview.find('[data-crouton-pane]').classes()).toEqual(expect.arrayContaining(['min-w-0', 'overflow-hidden']))
    const [outerB, innerB] = boardGrids(board)
    const [, innerP] = previewGrids(preview)
    expect(outerB!.style.minHeight).toBe('')
    expect(innerB!.style.minHeight).toBe('100%')
    expect(innerP!.style.minHeight).toBe('100%')
    expect(innerB!.style.gridTemplateRows).toBe(innerP!.style.gridTemplateRows)

    // Hiding Form leaves a side-by-side split with one vertical child.
    const collapsed = col([leaf('artists-stats'), row([leaf('artists-form'), col([leaf('artists-list'), leaf('artists-stats')])])])
    const cb = mountBoardReal(collapsed, ['artists-form'])
    await nextTick()
    const cp = mountPreview(partitionCollapsed(collapsed, ['artists-form']).visible!)
    const [, innerCB] = boardGrids(cb)
    const [, innerCP] = previewGrids(cp)
    expect(innerCB!.style.minHeight).toBe('100%')
    expect(innerCP!.style.minHeight).toBe('100%')
    // every wrapper between the cell and that grid carries h-full
    const chain: HTMLElement[] = []
    let el = innerCB!.parentElement
    while (el && el.dataset.handoff !== 'board-cell') { chain.push(el); el = el.parentElement }
    expect(el?.dataset.handoff).toBe('board-cell')
    expect(chain.length).toBeGreaterThanOrEqual(2)
    chain.forEach(w => expect(w.classList.contains('h-full')).toBe(true))
  })
})

describe('groups on the board (#3906)', () => {
  const savedGroup = (children: LayoutNode[], extra: Record<string, unknown> = {}): LayoutNode =>
    ({ type: 'nested', layout: { renderer: 'panes', root: row(children) }, ...extra } as any)
  const savedRow = () => row([leaf('artists-list', 85), savedGroup([leaf('narrow'), leaf('narrow')], { defaultSize: 15 })])

  it('19 · the list and the group get the same widths on both sides', async () => {
    const board = mountBoard(expandGroups(savedRow()))
    await nextTick()
    within2pct(boardWidths(board), resolveFlexRow(mountPreview(savedRow())).widths)
  })

  it('20 · every block inside a group keeps its own grip; the group gets one handle and a frame', async () => {
    const board = mountBoardReal(expandGroups(savedRow()))
    await nextTick()
    expect(board.findAll('[data-handoff="pane-grip"]')).toHaveLength(3)
    expect(board.findAll('[data-handoff="group-grip"]')).toHaveLength(1)
    const frames = board.findAll('[data-board-group]')
    expect(frames).toHaveLength(1)
    expect(frames[0]!.attributes('data-path')).toBe('1')
  })

  it('21 · a group with one block showing at this width has no frame and no handle', async () => {
    const tree = () => row([leaf('artists-list'), savedGroup([leaf('artists-stats'), leaf('artists-form')])])
    const all = mountBoardReal(expandGroups(tree()))
    await nextTick()
    expect(all.findAll('[data-handoff="group-grip"]')).toHaveLength(1)
    const one = mountBoardReal(expandGroups(tree()), ['artists-form'])
    await nextTick()
    expect(one.find('[data-handoff="board-only"]').exists()).toBe(true)
    expect(one.findAll('[data-handoff="pane-grip"]')).toHaveLength(2)
    expect(one.find('[data-handoff="group-grip"]').exists()).toBe(false)
    expect(one.find('[data-board-group]').exists()).toBe(false)
  })
})
