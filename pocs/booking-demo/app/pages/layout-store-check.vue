<script setup lang="ts">
/**
 * /layout-store-check (#3650) — proves the layout store contract on a real,
 * server-rendered page with no login. Two layouts side by side, each in its own
 * `CroutonLayoutStoreScope`: both `test` panes of one layout share one copy, the
 * other layout has its own, and the left layout's `test#2` pane is a separate copy.
 * Clicking a left `test` button raises both left `test` counters only.
 */
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { collectLayoutStores } from '@fyit/crouton-core/app/utils/layout-stores'

useHead({ title: 'Layout store check' })

const counter = (source: string): LayoutNode => ({ type: 'leaf', blockId: 'store-check-counter', source })

const left: LayoutTree = {
  renderer: 'panes',
  root: {
    type: 'split',
    direction: 'vertical',
    children: [
      { type: 'split', direction: 'horizontal', children: [counter('test'), counter('test')] },
      counter('test#2'),
    ],
  },
}
const right: LayoutTree = {
  renderer: 'panes',
  root: { type: 'split', direction: 'horizontal', children: [counter('test'), counter('test')] },
}

const layouts = [
  { name: 'left', tree: left, stores: collectLayoutStores(left) },
  { name: 'right', tree: right, stores: collectLayoutStores(right) },
]
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-4 p-6">
    <h1 class="text-lg font-semibold">
      Layout store check
    </h1>
    <p class="text-sm text-muted">
      Each layout owns its own <code>test</code> store. Clicking a left <code>test</code> button raises both left
      <code>test</code> counters; the right layout and <code>test#2</code> stay as they are.
    </p>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section
        v-for="l in layouts"
        :key="l.name"
        class="rounded-lg border border-default"
        :data-layout="l.name"
      >
        <p class="border-b border-default px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {{ l.name }} layout
        </p>
        <CroutonLayoutStoreScope :stores="l.stores">
          <CroutonLayoutRenderer :node="l.tree.root" :interactive="false" />
        </CroutonLayoutStoreScope>
      </section>
    </div>
  </div>
</template>
