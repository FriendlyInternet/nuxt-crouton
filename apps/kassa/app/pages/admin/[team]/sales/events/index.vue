<script setup lang="ts">
/**
 * Fanfare Events Dashboard — composed from layout blocks (#2532).
 *
 * The page body is a stored, editable layout (`layout_configs` id `default`,
 * team-scoped) rendered by the layout engine. With nothing stored it is the one
 * block it always was: the event card grid (`sales-events-grid`, kassa's own
 * block — one card = one entry into the event workspace, #2186). "Arrange" opens
 * the Layout page, where the grid can sit next to a list, stack on a phone, or
 * hide at a width — and this page follows.
 *
 * @route /admin/[team]/sales/events
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

definePageMeta({ middleware: ['auth'] })

const { t } = useT()
const { teamSlug } = useTeamContext()
const crouton = useCrouton()

const LAYOUT_ID = 'default'
const defaultTree: LayoutTree = { renderer: 'panes', root: { type: 'leaf', blockId: 'sales-events-grid' } }

const { load } = useCroutonLayoutStore()
const tree = ref<LayoutTree>(defaultTree)
onMounted(async () => {
  const stored = await load(LAYOUT_ID)
  if (stored?.root) tree.value = stored
})
</script>

<template>
  <div class="p-4 sm:p-6 space-y-6">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">{{ t('sales.events.title') }}</h1>
        <p class="text-muted text-sm mt-1">{{ t('sales.events.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-layout-dashboard"
          :label="t('sales.events.arrange', 'Arrange')"
          :to="`/admin/${teamSlug}/layout`"
          data-handoff="events-arrange"
        />
        <CroutonImportButton collection="salesEvents" />
        <UButton
          color="primary"
          icon="i-lucide-plus"
          :label="t('common.create')"
          @click="crouton.open('create', 'salesEvents')"
        />
      </div>
    </div>

    <!-- Page render (`interactive=false`): blocks flow to their content and the page
         scrolls as one; breakpoints resolve at this element's real width. -->
    <ClientOnly>
      <CroutonLayoutResponsiveRenderer :tree="tree" :interactive="false" data-handoff="events-layout" />
    </ClientOnly>
  </div>
</template>
