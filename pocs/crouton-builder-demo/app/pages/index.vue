<script setup lang="ts">
/**
 * Crouton Builder — live POC (epic #868). WS8 (#899): the three tabs (Compose /
 * Responsive+Collapse / Breakpoint author) are folded into the ONE
 * `CroutonLayoutZoomShell`, so you navigate by ZOOM rather than tab buttons:
 *
 *   Site (crouton-flow page flow)  →  Page  →  App (compose canvas)  →  Breakpoints
 *
 * One shared layout tree threads every level: a snap you make on the compose canvas
 * is the same edit the breakpoint author shows when you zoom further in.
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

useHead({ title: 'Crouton Builder — live POC' })

// Bump on every deploy so you can confirm (esp. on mobile, where the browser caches
// hard) that you're looking at the latest build, not a stale one.
const BUILD = 'b20 · 26 Jun · Nuxt UI 4 cleanup — USlider ruler + theme-token zoom dots (#906)'

// Backend-free demo blocks (registered in app.config) so the canvas/author can be
// driven without auth. A `nested` app on the Reports page demonstrates
// pane-click-to-zoom: open it and you descend into its own sub-layout.
const split = (a: string, b: string, dir: 'horizontal' | 'vertical' = 'horizontal'): LayoutTree['root'] => ({
  type: 'split', direction: dir,
  children: [
    { type: 'leaf', blockId: a, defaultSize: 50 },
    { type: 'leaf', blockId: b, defaultSize: 50 },
  ],
})

interface ZoomPage { id: string, label: string, icon?: string, tree: LayoutTree }

const pages: ZoomPage[] = [
  {
    id: 'dashboard', label: 'Dashboard', icon: 'i-lucide-layout-dashboard',
    // Three free cards on entry — snap two together and the tree gains a nested split,
    // which the breakpoint author then shows: a compose edit, reflected one level in.
    // Ships with an authored breakpoint so the WS6 collapse MOTION is visible by zoom
    // alone: below 640px the middle pane collapses with `spring-drawer` (drag the ruler
    // in the Breakpoints level across 640 to see it; switch the motion with the picker).
    tree: {
      renderer: 'panes',
      root: {
        type: 'split', direction: 'horizontal',
        children: [
          { type: 'leaf', blockId: 'demo-a', defaultSize: 34 },
          { type: 'leaf', blockId: 'demo-b', defaultSize: 33 },
          { type: 'leaf', blockId: 'demo-a', defaultSize: 33 },
        ],
      },
      breakpoints: [
        { minWidth: 0, label: 'Phone', collapsed: ['demo-b'], collapseStyle: 'spring-drawer' },
        { minWidth: 640, label: 'Wide', collapsed: [] },
      ],
    },
  },
  {
    id: 'reports', label: 'Reports', icon: 'i-lucide-bar-chart-3',
    tree: {
      renderer: 'panes',
      root: {
        type: 'split', direction: 'horizontal',
        children: [
          // A nested "app" — open it to zoom into its own sub-layout (pane-click-to-zoom).
          { type: 'nested', label: 'Analytics', defaultSize: 60, layout: { renderer: 'panes', root: split('demo-a', 'demo-b', 'vertical') } },
          { type: 'leaf', blockId: 'demo-b', defaultSize: 40 },
        ],
      },
    },
  },
  {
    id: 'settings', label: 'Settings', icon: 'i-lucide-settings',
    tree: { renderer: 'panes', root: { type: 'leaf', blockId: 'demo-a' } },
  },
]

// The same pages as crouton-flow rows (a sitemap): Dashboard is the root, the others
// hang off it via `parentId` — exactly the data CroutonFlowSiteFlow wires into cards.
const pageRows = [
  { id: 'dashboard', label: 'Dashboard', parentId: null },
  { id: 'reports', label: 'Reports', parentId: 'dashboard' },
  { id: 'settings', label: 'Settings', parentId: 'dashboard' },
]
const pageById = (id: unknown): ZoomPage | undefined => pages.find(p => p.id === String(id))

// The host owns persistence; here we just keep the latest emitted page tree so a
// reader can confirm edits round-trip (the shell already caches per-page in-session).
const lastEdited = ref<LayoutTree | null>(null)
function onLayoutChange(tree: LayoutTree) {
  lastEdited.value = tree
}
</script>

<template>
  <div class="flex h-screen flex-col bg-default text-default">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-5 py-3">
      <h1 class="text-base font-semibold">Maquette — live POC</h1>
      <p class="text-xs text-muted">Zoom in/out — no tabs. Epic #868 · WS8 #899</p>
      <span class="ml-auto rounded-full border border-default bg-elevated px-2 py-0.5 font-mono text-[10px] text-muted">{{ BUILD }}</span>
    </header>

    <div class="min-h-0 flex-1">
      <ClientOnly>
        <CroutonLayoutZoomShell
          site-label="builder.demo"
          :pages="pages"
          @layout-change="onLayoutChange"
        >
          <!-- L0 Site — the real crouton-flow page flow (cards = pages, lines =
               parentId). Double-click / ⤡ a card → the shell zooms into that page. -->
          <template #site="{ zoomIntoPage }">
            <CroutonFlowSiteFlow
              :pages="pageRows"
              collection="pagesPages"
              label-field="label"
              parent-field="parentId"
              @zoom-into-page="(row: Record<string, unknown>) => { const p = pageById(row.id); if (p) zoomIntoPage(p) }"
            />
          </template>
        </CroutonLayoutZoomShell>
      </ClientOnly>
    </div>
  </div>
</template>
