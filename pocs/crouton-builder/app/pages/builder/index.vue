<script setup lang="ts">
/**
 * /builder — the SITE flow (the level you land on).
 *
 * A CroutonFlow canvas of page cards (lines = `parentId`); tapping a card (or its
 * ⤢ / double-click) opens that page's board at `/builder/[pageId]`. This is REAL
 * routing — the graduated replacement for the POC's one-route `selectedPageId`
 * v-if swap (spec: `page-site-routing`). The page cards render REAL rows of the
 * `builderPages` collection (spec: `real-collections`).
 *
 * Behaviour contract: `site-page-two-level`.
 */
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

definePageMeta({ title: 'Builder · Site' })
useHead({ title: 'Builder · Site' })

const { items: pages, pending, refresh } = await useCollectionQuery('builderPages')

// Map the collection rows into the shape CroutonFlowSiteFlow renders: id · label ·
// parentId (→ edges) · a hint icon · the slug subtitle.
const pageRows = computed(() =>
  (pages.value as BuilderPage[]).map((p) => ({
    id: p.id,
    label: p.title,
    parentId: p.parentId ?? null,
    slug: p.slug,
    icon: p.isHome ? 'i-lucide-home' : 'i-lucide-file',
    status: p.status,
  })),
)

// Open a page's board — REAL navigation (deep-linkable, browser back/forward work).
function openPage(page: Record<string, unknown>) {
  navigateTo(`/builder/${page.id}`)
}

// Create a new page and refresh the flow.
const { create } = useCollectionMutation('builderPages')
const creating = ref(false)
async function newPage() {
  creating.value = true
  try {
    const n = (pages.value?.length ?? 0) + 1
    await create({
      title: `Page ${n}`,
      slug: `page-${n}`,
      status: 'draft',
      showInNavigation: true,
      isHome: false,
      board: {},
      parentId: null,
    })
    await refresh()
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex h-[100dvh] flex-col">
    <header class="flex items-center gap-3 border-b border-default px-4 py-2">
      <UIcon name="i-lucide-layout-dashboard" class="size-5 text-primary" />
      <div>
        <h1 class="text-sm font-semibold leading-tight">Site</h1>
        <p class="text-xs text-muted leading-tight">Wire pages together — tap a card to build it</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <UButton
          icon="i-lucide-plus"
          size="sm"
          :loading="creating"
          @click="newPage"
        >
          New page
        </UButton>
      </div>
    </header>

    <div class="relative min-h-0 flex-1">
      <div v-if="pending" class="flex h-full items-center justify-center text-sm text-muted">
        Loading pages…
      </div>
      <CroutonFlowSiteFlow
        v-else
        :pages="pageRows"
        collection="builderPages"
        parent-field="parentId"
        label-field="label"
        @zoom-into-page="openPage"
        @page-click="(id: string, page: Record<string, unknown>) => openPage(page)"
      />
    </div>
  </div>
</template>
