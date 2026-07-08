/**
 * Site level (#940, approach B) — a page-flow ON TOP of the spike board. Pick a page on the
 * flow → its layout seeds the board → arrange/edit (incl. the focus editor) → "← Pages" stores
 * it back. One board (= one layout) per page, persisted in-session so zooming out to Site and
 * back keeps your edits exactly.
 */
import { computed, nextTick, provide, ref } from 'vue'
import type { Ref } from 'vue'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { sizeOf } from '~/utils/spike-layout'
import { pageById } from '~/utils/spike-demo-data'
import type { FlowNode, SpikeFlowHandle } from '~/utils/spike-board'

export function useSpikePageNav(opts: {
  nodes: Ref<FlowNode[]>
  flowRef: Ref<SpikeFlowHandle | null>
  nextSeq: () => number
  closeEdit: () => void
  isEditing: () => boolean
  resetTransient: () => void
}) {
  const { nodes, flowRef, nextSeq, closeEdit, isEditing, resetTransient } = opts

  // Per-page board state — persist the FlowNode[] verbatim so positions, merges, and
  // per-node breakpoints all survive a round-trip out to Site and back (no lossy recompile).
  const pageBoards = new Map<string, FlowNode[]>()
  const selectedPageId = ref<string | null>(null)
  // Direction of the page⇄site cross-fade: 'in' grows the page in (opening), 'out' settles back to the
  // flow (returning). Set before the swap so the right curve plays. (#940)
  const zoomDir = ref<'in' | 'out'>('in')
  const currentPageLabel = computed(() => (selectedPageId.value ? pageById(selectedPageId.value)?.label ?? 'Page' : ''))
  // The page being edited → drives the page-shell header (icon · name · path · access · status). The
  // header collapses to just icon+name+chips; expanding reveals the path + full access/status labels.
  const currentPage = computed(() => (selectedPageId.value ? pageById(selectedPageId.value) ?? null : null))

  /** Seed an existing page as ONE composed node — the whole layout, badged as THE page (#942), so
   *  zooming in shows what the page actually looks like (WYSIWYG), not loose exploded cards. Drafts
   *  you add later coexist beside it. (An empty page just starts with a blank board.) */
  function treeToBoardNodes(tree: LayoutTree): FlowNode[] {
    return [{
      id: `page-${selectedPageId.value}-${nextSeq()}`,
      type: 'default',
      position: { x: 80, y: 120 },
      data: { node: tree.root, label: pageById(selectedPageId.value)?.label ?? 'Page', bp: tree.breakpoints, isPage: true },
    }]
  }

  // Same contract the package's SiteFlow provides — our SpikePageCard injects this to "open the full
  // page" (descend into the board). enterPage is a hoisted function declaration, available here.
  provide('croutonSiteFlowZoom', (id: string) => enterPage(id))
  /** Stash the current board onto the open page so it can be restored on return. */
  function stashCurrentBoard() {
    if (selectedPageId.value) pageBoards.set(selectedPageId.value, nodes.value)
  }
  /** Centre + fit the page's layout on entry. The flow is freshly mounted (v-if) and Vue Flow
   *  measures node size async, so a single early fit frames a stale (zero/partial) box and the
   *  layout falls off-screen — retry across a few frames until the node is measured. */
  function fitPage() {
    if (isEditing()) return
    const fit = () => {
      const page = nodes.value.find(n => n.data.isPage)
      if (page) {
        // Frame the page node by its KNOWN geometry (position + footprint size), NOT Vue Flow's
        // measured dimensions — those are stale on a fresh mount. duration:0 = snap to fitted on
        // arrival (no visible zoom-out animation); the early retries just make sure the snap lands
        // once flowRef is mounted.
        const s = sizeOf(page.data.node)
        flowRef.value?.fitBounds?.({ x: page.position.x, y: page.position.y, width: s.width, height: s.height }, { duration: 0, padding: 0.18 })
      }
      else {
        flowRef.value?.fitView?.({ duration: 0, padding: 0.2, maxZoom: 1 })
      }
    }
    nextTick(fit)
    for (const d of [40, 120, 300]) window.setTimeout(fit, d)
  }
  /** Site → page: load (or first-seed) that page's board and show the editor. */
  function enterPage(id: string) {
    const page = pageById(id)
    if (!page) return
    stashCurrentBoard()
    // clean transient board state for a fresh entry
    closeEdit()
    resetTransient() // incl. fresh undo context — don't undo across page boundaries
    zoomDir.value = 'in'
    selectedPageId.value = id
    nodes.value = pageBoards.get(id) ?? treeToBoardNodes(page.tree)
    fitPage()
  }
  /** Page → Site: persist the board and go back to the page flow. */
  function exitToPages() {
    stashCurrentBoard()
    closeEdit()
    zoomDir.value = 'out'
    selectedPageId.value = null
  }

  return { selectedPageId, zoomDir, currentPage, currentPageLabel, enterPage, exitToPages }
}
