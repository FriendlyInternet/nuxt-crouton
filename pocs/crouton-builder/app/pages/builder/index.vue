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

// Require auth: a logged-out visitor should land on login, not a builder shell whose
// team-gated controls sit forever in "Preparing…" (there's no session → no team).
definePageMeta({ title: 'Builder · Site', middleware: ['auth'] })
useHead({ title: 'Builder · Site' })

const { items: pages, pending, refresh } = await useCollectionQuery('builderPages')

// Team context resolves ASYNCHRONOUSLY after login: the session bootstrap lists the
// user's orgs and sets the first active, which can take a couple of seconds. Until it
// lands, `getTeamId()` is undefined — the page query is skipped (it auto-refetches when
// the team resolves) and any mutation would REJECT. So we gate "New page" on readiness:
// disabled + a spinner ("preparing") while the team resolves, so an early tap can't fire
// a silently-failing create (spec: the #988 lesson — never let a control lie about working).
const { teamId } = useTeamContext()
const teamReady = computed(() => !!teamId.value)
const notify = useNotify()

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
    // Belt-and-suspenders: if the team resolved between render and tap, wait it out
    // (up to 8s) rather than reject. Normally the button is disabled until ready.
    if (!teamReady.value) {
      await until(teamReady).toBe(true, { timeout: 8000 }).catch(() => {})
    }
    if (!teamReady.value) {
      notify.error('Still preparing your workspace', { description: 'Team context is loading — try again in a moment.' })
      return
    }
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
          :loading="creating || !teamReady"
          :disabled="!teamReady"
          @click="newPage"
        >
          {{ teamReady ? 'New page' : 'Preparing…' }}
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
