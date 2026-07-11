<script setup lang="ts">
/**
 * Event Workspace shell (reusable)
 *
 * Kassa-first: resolves an event from its slug, then renders the header
 * (event switcher + actions) above the POS, which is the main surface. No
 * tabs — the two former tabs became header-driven panels:
 *
 *  - "Instellingen" expands the settings (SettingsTab) inline under the header
 *  - "Bestellingen" toggles the orders list (OrdersTab) as a pane beside
 *    the POS's products/cart columns
 *  - "Klanten" (recurring-clients mode only) toggles the client end-receipts
 *    list (ClientsPanel) as another pane
 *  - "Data" (admin sessions only — PIN helpers never see it) toggles the
 *    event's sales numbers (DataPanel) as a third pane — any combination can
 *    be open at once, side by side
 *
 * Used in two places:
 *  - the admin page `/admin/[team]/sales/events/[slug]`
 *  - the `eventWorkspaceBlock` CMS block, for signed-in team members only
 *    (event fixed by the editor, so the switcher is hidden; the header stays
 *    so the settings/orders toggles are reachable). Anonymous visitors get
 *    <SalesPosPanel> from the block instead — never this shell.
 *
 * @see app/pages/admin/[team]/sales/events/[slug]/index.vue
 * @see app/components/Blocks/EventWorkspaceRender.vue
 */
// Reka UI splitter (the primitive Nuxt UI's resizable dashboard panels build
// on) — UDashboardPanel itself needs a top-level UDashboardGroup, which can't
// be embedded mid-page.
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { Ref } from 'vue'
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = withDefaults(defineProps<{
  /** Slug of the event to render. */
  eventSlug: string
  /**
   * Team route param used to build navigation targets (switch event).
   * Defaults to `route.params.team`, which is present in both admin
   * (`/admin/[team]/...`) and public CMS (`/[team]/...`) routes.
   */
  teamParam?: string
  /** Show the event switcher dropdown (hidden in the block — event is fixed). */
  showSwitcher?: boolean
  /** Show the header action buttons (settings / orders toggles). */
  showHeaderActions?: boolean
  /**
   * Show the whole header row (event name + actions). Hidden in the block,
   * where the page already provides the event title and these actions don't
   * apply.
   */
  showHeader?: boolean
  /**
   * Render a close ✕ at the end of the top row (strip on narrow, header on
   * wide) and emit `close` — for hosts that mount the shell in a fullscreen
   * modal (EventWorkspaceRender), so they don't need their own header row.
   */
  closable?: boolean
  /**
   * Show the narrow-mode control strip above the kassa. Hosts whose launcher
   * is the navigation hub (the block's launcher cards) turn it off — the
   * kassa then runs full-bleed, with the edit pencil back in the category
   * tabs row and the ✕ beside it (closable pass-down).
   */
  showStrip?: boolean
}>(), {
  showSwitcher: true,
  showHeaderActions: true,
  showHeader: true,
  showStrip: true
})

const emit = defineEmits<{ close: [] }>()

const { t } = useT()
const { open } = useCrouton()
const route = useRoute()
const router = useRouter()

// PIN helpers hold a scoped token, not a session, so `loggedIn` is the
// workspace's admin discriminator (same signal as the POS `editable` gate and
// the team-members-only blocks) — it gates the admin-only data pane below.
const { loggedIn } = useAuth()

const teamParam = computed(() => props.teamParam || (route.params.team as string))
const eventSlug = computed(() => props.eventSlug)

const { items: events } = await useCollectionQuery('salesEvents')

const event = computed(() =>
  (events.value as SalesEvent[] | null)?.find(e => e.slug === eventSlug.value)
)

const eventOptions = computed(() =>
  (events.value as SalesEvent[] | null)?.map(e => ({
    id: e.id,
    label: e.title,
    slug: e.slug
  })) || []
)

function switchEvent(eventId: string) {
  const selected = eventOptions.value.find(e => e.id === eventId)
  if (selected && selected.slug !== eventSlug.value) {
    router.push(`/admin/${teamParam.value}/sales/events/${selected.slug}`)
  }
}

function openCreateEvent() {
  open('create', 'salesEvents')
}

// The workspace's own event can be deleted from the settings panel — once the
// delete mutation lands this page has nothing to show, so fall back to the
// events list.
const unhookMutation = useNuxtApp().hook('crouton:mutation', (payload: any) => {
  if (
    payload.operation === 'delete'
    && payload.collection === 'salesEvents'
    && event.value
    && payload.itemIds?.includes(event.value.id)
  ) {
    router.push(`/admin/${teamParam.value}/sales/events`)
  }
})
onUnmounted(unhookMutation)

// Header-driven panels. Local state — not worth query params, and the CMS
// block (showHeaderActions=false) never exposes the toggles.
const settingsOpen = ref(false)

// SettingsTab's save API — the Save button lives in our header row. Handed up
// via the child's `register` emit: a template ref binds before an async-setup
// component's defineExpose attaches, so it would stay a bare public proxy and
// the button would never enable (#1321).
const settingsTab = shallowRef<{ save: () => Promise<void>, dirty: Ref<boolean>, saving: Ref<boolean> } | null>(null)
const settingsDirty = computed(() => settingsTab.value?.dirty.value ?? false)
const settingsSaving = computed(() => settingsTab.value?.saving.value ?? false)

// Side panes beside the POS: orders, clients (end-of-tab receipts —
// recurring-clients mode only), and data (sales numbers — admins only).
// Independent toggles — all can be open at once; each closed pane keeps a
// vertical tab hanging in the right gutter. Persisted in localStorage so the
// arrangement survives reloads, matching the splitter ratios (autoSaveId).
// initOnMounted keeps SSR markup at the default (closed) and restores after
// hydration.
const ordersOpen = useLocalStorage('sales-workspace-orders-open', false, { initOnMounted: true })
const clientsOpen = useLocalStorage('sales-workspace-clients-open', false, { initOnMounted: true })
const dataOpen = useLocalStorage('sales-workspace-data-open', false, { initOnMounted: true })

// The stored flags are global, but the clients pane only exists in
// recurring-clients mode and the data pane only for admin sessions — gate
// the persisted values per event/session.
const clientsPaneOpen = computed(() => clientsOpen.value && !!event.value?.requiresClient)
const dataPaneOpen = computed(() => dataOpen.value && loggedIn.value)

// Narrow screens can't host side-by-side panes — the splitter would squeeze
// the kassa to nothing. Below lg the panes become slideovers instead, toggled
// from a button row above the kassa. Their open state is ephemeral (not the
// persisted refs): an overlay auto-opening on page load would trap the user.
// Hydration-stable: the media query must read false until mounted so the
// client's first render matches the SSR markup (which can't know the
// viewport). Flipping it during hydration removes the SSR'd header subtree
// mid-recovery and detaches reka-ui's splitter context ("No group found" →
// error page). Cost: one desktop-layout frame on phones before the flip.
const isNarrowQuery = useMediaQuery('(max-width: 1023px)')
const hydrated = ref(false)
const isNarrow = computed(() => hydrated.value && isNarrowQuery.value)
const ordersSlideoverOpen = ref(false)
const clientsSlideoverOpen = ref(false)
const dataSlideoverOpen = ref(false)

onMounted(() => { hydrated.value = true })

// Settings follow the same split: inline collapsible under the header on
// desktop, but a slideover on narrow screens — the inline panel's nested
// containers eat too much of a phone viewport. One toggle, two surfaces.
const settingsSlideoverOpen = ref(false)
const settingsToggled = computed(() => isNarrow.value ? settingsSlideoverOpen.value : settingsOpen.value)

function toggleSettings() {
  if (isNarrow.value) settingsSlideoverOpen.value = !settingsSlideoverOpen.value
  else settingsOpen.value = !settingsOpen.value
}

// Kassa edit mode, lifted so the narrow tab strip can host the pencil (the
// inline pencil in the kassa's category-tabs row is hidden on narrow via
// hide-edit-toggle — one toggle, never two).
const kassaEditMode = ref(false)

// The gutter is reserved whenever at least one vertical tab is hanging.
// Narrow mode has no gutter — the toggles live in the button row instead.
const hasGutter = computed(() =>
  !isNarrow.value
  && (
    !ordersOpen.value
    || (!!event.value?.requiresClient && !clientsPaneOpen.value)
    || (loggedIn.value && !dataPaneOpen.value)
  )
)

// Orders-pane filters: the toggle lives in the pane header (next to ✕), the
// selects live in OrdersTab — state is lifted here, count feeds the chip.
const ordersFiltersOpen = ref(false)
const ordersFilterCount = ref(0)
</script>

<template>
  <div v-if="!event" class="flex items-center justify-center h-full">
    <div class="text-center">
      <UIcon name="i-lucide-alert-circle" class="text-4xl text-muted mb-2" />
      <p class="text-muted">{{ t('sales.events.eventNotFound') }}</p>
    </div>
  </div>

  <div v-else class="space-y-4">
    <!-- Header + settings: one bordered container. The header row (event
         switcher, settings toggle right beside it, Save on the right while
         open) stays visible; the settings slide open underneath, inside the
         same panel. Same right gutter as the kassa when a vertical tab hangs
         there, so the container aligns with the kassa edge, not the gutter. -->
    <!-- Desktop only — on narrow the strip below carries the switcher and
         toggles, and the event name is already where you came from (events
         list) plus the page title. -->
    <div v-if="showHeader && !isNarrow" :class="hasGutter ? 'pe-11' : ''">
      <div class="border border-default rounded-xl bg-elevated/20">
        <div class="flex flex-wrap items-center gap-2 p-3 sm:p-4">
          <USelectMenu
            v-if="showSwitcher"
            :model-value="event.id"
            :items="eventOptions"
            value-key="id"
            :placeholder="t('sales.events.selectEvent')"
            icon="i-lucide-ticket"
            size="sm"
            class="w-56"
            :ui="{ base: 'font-semibold' }"
            @update:model-value="switchEvent"
          >
            <!-- Create-from-dropdown, same pattern as CroutonFormReferenceSelect -->
            <template #content-top>
              <div class="p-1">
                <UButton
                  color="neutral"
                  icon="i-lucide-plus"
                  variant="soft"
                  block
                  @click="openCreateEvent"
                >
                  {{ t('reference.createNew', { label: t('sales.events.title') }) }}
                </UButton>
              </div>
            </template>
          </USelectMenu>
          <h2 v-else class="font-semibold text-lg">{{ event.title }}</h2>
          <!-- Desktop only — on narrow the toggle lives in the tab strip. -->
          <UButton
            v-if="showHeaderActions && !isNarrow"
            icon="i-lucide-settings"
            size="sm"
            color="neutral"
            :variant="settingsToggled ? 'solid' : 'outline'"
            @click="toggleSettings"
          >
            {{ t('sales.events.settings') }}
          </UButton>
          <p v-if="event.eventType" class="text-muted text-sm ms-2">
            {{ event.eventType }}
          </p>
          <!-- Panel-wide Save, hosted here so it shares the header line.
               Drives the { save, dirty, saving } API SettingsTab registers. -->
          <div v-if="settingsOpen && !isNarrow" class="ms-auto flex items-center gap-3">
            <span v-if="settingsDirty" class="text-sm text-muted hidden sm:inline">
              {{ t('sales.workspace.unsavedChanges') }}
            </span>
            <UButton
              size="sm"
              :loading="settingsSaving"
              :disabled="!settingsDirty"
              @click="settingsTab?.save()"
            >
              {{ t('sales.common.save') }}
            </UButton>
          </div>
          <!-- Fullscreen-modal exit (closable) — the wide-viewport twin of the
               strip's ✕, for a modal resized past the narrow breakpoint. -->
          <UButton
            v-if="closable"
            icon="i-lucide-x"
            size="sm"
            color="neutral"
            variant="ghost"
            :class="settingsOpen ? '' : 'ms-auto'"
            :aria-label="t('sales.common.close')"
            @click="emit('close')"
          />
        </div>

        <!-- Own Suspense — SettingsTab is an async-setup component. Desktop
             only: narrow screens get the settings slideover below instead
             (never both, so only one instance registers its save API). -->
        <UCollapsible :open="settingsOpen && !isNarrow">
          <template #content>
            <div class="p-4 sm:p-6 pt-1">
              <Suspense>
                <SalesEventWorkspaceSettingsTab :event="event" hide-save-bar @register="settingsTab = $event" />
                <template #fallback>
                  <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
                </template>
              </Suspense>
            </div>
          </template>
        </UCollapsible>
      </div>
    </div>

    <!-- Narrow screens: the side panes can't fit beside the kassa, so they
         open as slideovers from this row. Styled as a segmented tab strip
         (matching the kassa's category tabs) rather than loose buttons —
         they're the phone's stand-in for the pane/gutter tabs. -->
    <div v-if="isNarrow && showStrip" class="flex items-center rounded-lg bg-elevated p-1 gap-1 overflow-x-auto">
      <!-- Compact event switcher (icon-only): the header row is hidden on
           narrow, so switching events lives here. -->
      <USelectMenu
        v-if="showHeader && showSwitcher"
        :model-value="event.id"
        :items="eventOptions"
        value-key="id"
        icon="i-lucide-ticket"
        size="sm"
        color="neutral"
        variant="ghost"
        class="shrink-0"
        :aria-label="t('sales.events.selectEvent')"
        @update:model-value="switchEvent"
      >
        <template #default>
          <span class="sr-only">{{ event.title }}</span>
        </template>
        <template #content-top>
          <div class="p-1">
            <UButton
              color="neutral"
              icon="i-lucide-plus"
              variant="soft"
              block
              @click="openCreateEvent"
            >
              {{ t('reference.createNew', { label: t('sales.events.title') }) }}
            </UButton>
          </div>
        </template>
      </USelectMenu>
      <UButton
        icon="i-lucide-clipboard-list"
        size="sm"
        color="neutral"
        :variant="ordersSlideoverOpen ? 'solid' : 'ghost'"
        class="flex-1 justify-center whitespace-nowrap"
        @click="ordersSlideoverOpen = true"
      >
        {{ t('sales.orders.title') }}
      </UButton>
      <UButton
        v-if="event.requiresClient"
        icon="i-lucide-users"
        size="sm"
        color="neutral"
        :variant="clientsSlideoverOpen ? 'solid' : 'ghost'"
        class="flex-1 justify-center whitespace-nowrap"
        @click="clientsSlideoverOpen = true"
      >
        {{ t('sales.workspace.clientsPanel.button') }}
      </UButton>
      <UButton
        v-if="loggedIn"
        icon="i-lucide-chart-line"
        size="sm"
        color="neutral"
        :variant="dataSlideoverOpen ? 'solid' : 'ghost'"
        class="flex-1 justify-center whitespace-nowrap"
        @click="dataSlideoverOpen = true"
      >
        {{ t('sales.workspace.dataPanel.button') }}
      </UButton>
      <!-- Settings toggle, moved here from the header row on narrow screens. -->
      <UButton
        v-if="showHeaderActions"
        icon="i-lucide-settings"
        size="sm"
        color="neutral"
        :variant="settingsSlideoverOpen ? 'solid' : 'ghost'"
        class="shrink-0 justify-center"
        :aria-label="t('sales.events.settings')"
        @click="toggleSettings"
      />
      <!-- Kassa edit-mode pencil, lifted out of the category-tabs row on
           narrow screens (hide-edit-toggle on the POS below). -->
      <UButton
        v-if="loggedIn"
        size="sm"
        :color="kassaEditMode ? 'primary' : 'neutral'"
        :variant="kassaEditMode ? 'solid' : 'ghost'"
        :icon="kassaEditMode ? 'i-lucide-check' : 'i-lucide-pencil'"
        class="shrink-0 justify-center"
        :aria-label="kassaEditMode ? t('sales.workspace.doneEditing') : t('sales.workspace.editCatalog')"
        @click="kassaEditMode = !kassaEditMode"
      />
      <!-- Exit for fullscreen-modal hosts: the strip is the header, so the
           close lives here instead of a wasted row above (closable). -->
      <UButton
        v-if="closable"
        icon="i-lucide-x"
        size="sm"
        color="neutral"
        variant="ghost"
        class="shrink-0 justify-center"
        :aria-label="t('sales.common.close')"
        @click="emit('close')"
      />
    </div>

    <!-- Kassa: the main surface, full remaining viewport height. Orders or
         clients join as a resizable pane on toggle (drag the divider; sizes
         persist via autoSaveId). The vertical tabs hang just OUTSIDE the
         kassa's right edge (reserved gutter via pe-11, so they never
         overflow the page). -->
    <div class="relative" :class="hasGutter ? 'pe-11' : ''">
    <div class="flex border border-default rounded-xl overflow-clip bg-default h-[calc(100dvh-13rem)] min-h-[28rem]">
      <SplitterGroup
        direction="horizontal"
        auto-save-id="sales-workspace-pos"
        class="flex flex-1 min-w-0"
      >
        <SplitterPanel id="pos" :order="1" :min-size="35" class="min-w-0">
          <!-- No panel header: the workspace header above already names the
               event (the standalone order page keeps it). -->
          <SalesPosPanel
            :event-slug="event.slug"
            :team-param="teamParam"
            :show-header="false"
            :hide-edit-toggle="isNarrow && showStrip"
            :closable="closable && isNarrow && !showStrip"
            v-model:edit-mode="kassaEditMode"
            @close="emit('close')"
          />
        </SplitterPanel>
        <template v-if="ordersOpen && !isNarrow">
          <SplitterResizeHandle
            class="w-1 shrink-0 bg-accented hover:bg-primary/60 data-[state=drag]:bg-primary transition-colors"
          />
          <SplitterPanel id="orders" :order="2" :default-size="30" :min-size="18" class="min-w-0 flex flex-col">
            <!-- Pane header mirrors the hanging tab (shared PaneHeader:
                 h-14 matches the POS header rows so all bottom borders align). -->
            <SalesEventWorkspacePaneHeader
              icon="i-lucide-clipboard-list"
              :title="t('sales.orders.title')"
              @close="ordersOpen = false"
            >
              <UChip :show="ordersFilterCount > 0" :text="ordersFilterCount" size="xl" inset>
                <UButton
                  icon="i-lucide-filter"
                  size="xs"
                  color="neutral"
                  :variant="ordersFiltersOpen ? 'soft' : 'ghost'"
                  :aria-label="t('sales.workspace.filters')"
                  @click="ordersFiltersOpen = !ordersFiltersOpen"
                />
              </UChip>
            </SalesEventWorkspacePaneHeader>
            <div class="flex-1 overflow-y-auto p-4 pt-2">
              <Suspense>
                <SalesEventWorkspaceOrdersTab
                  v-model:filters-open="ordersFiltersOpen"
                  :event="event"
                  @update:active-filter-count="ordersFilterCount = $event"
                />
                <template #fallback>
                  <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
                </template>
              </Suspense>
            </div>
          </SplitterPanel>
        </template>
        <template v-if="clientsPaneOpen && !isNarrow">
          <SplitterResizeHandle
            class="w-1 shrink-0 bg-accented hover:bg-primary/60 data-[state=drag]:bg-primary transition-colors"
          />
          <SplitterPanel id="clients" :order="3" :default-size="25" :min-size="15" class="min-w-0 flex flex-col">
            <SalesEventWorkspacePaneHeader
              icon="i-lucide-users"
              :title="t('sales.workspace.clientsPanel.title')"
              @close="clientsOpen = false"
            />
            <div class="flex-1 overflow-y-auto p-4 pt-2">
              <SalesEventWorkspaceClientsPanel :event="event" />
            </div>
          </SplitterPanel>
        </template>
        <template v-if="dataPaneOpen && !isNarrow">
          <SplitterResizeHandle
            class="w-1 shrink-0 bg-accented hover:bg-primary/60 data-[state=drag]:bg-primary transition-colors"
          />
          <SplitterPanel id="data" :order="4" :default-size="30" :min-size="18" class="min-w-0 flex flex-col">
            <SalesEventWorkspacePaneHeader
              icon="i-lucide-chart-line"
              :title="t('sales.workspace.dataPanel.title')"
              @close="dataOpen = false"
            />
            <div class="flex-1 overflow-y-auto p-4 pt-2">
              <SalesEventWorkspaceDataPanel :event="event" :team-param="teamParam" />
            </div>
          </SplitterPanel>
        </template>
      </SplitterGroup>

    </div>

    <!-- Vertical pane tabs: hang just outside the kassa's right edge while
         their pane is closed (the open pane has its own close button).
         top-14 drops them under the POS header line (client-selector row).
         UButtons (not raw buttons) so themes reach them (#1410); the class
         list keeps the gutter geometry + vertical writing mode. -->
    <div
      v-if="hasGutter"
      class="absolute top-14 left-[calc(100%-2.75rem)] -ml-px flex flex-col gap-2"
    >
      <UButton
        v-if="!ordersOpen"
        color="neutral"
        variant="soft"
        class="flex-col items-center gap-1.5 px-1.5 py-3 rounded-none rounded-e-md
               border border-l-0 border-default bg-elevated/60 hover:bg-elevated
               text-muted hover:text-highlighted"
        :aria-label="t('sales.orders.title')"
        @click="ordersOpen = true"
      >
        <UIcon name="i-lucide-clipboard-list" class="size-4 shrink-0" />
        <span class="[writing-mode:vertical-rl] text-sm font-medium tracking-wide">
          {{ t('sales.orders.title') }}
        </span>
      </UButton>
      <UButton
        v-if="event.requiresClient && !clientsOpen"
        color="neutral"
        variant="soft"
        class="flex-col items-center gap-1.5 px-1.5 py-3 rounded-none rounded-e-md
               border border-l-0 border-default bg-elevated/60 hover:bg-elevated
               text-muted hover:text-highlighted"
        :aria-label="t('sales.workspace.clientsPanel.button')"
        @click="clientsOpen = true"
      >
        <UIcon name="i-lucide-users" class="size-4 shrink-0" />
        <span class="[writing-mode:vertical-rl] text-sm font-medium tracking-wide">
          {{ t('sales.workspace.clientsPanel.button') }}
        </span>
      </UButton>
      <UButton
        v-if="loggedIn && !dataOpen"
        color="neutral"
        variant="soft"
        class="flex-col items-center gap-1.5 px-1.5 py-3 rounded-none rounded-e-md
               border border-l-0 border-default bg-elevated/60 hover:bg-elevated
               text-muted hover:text-highlighted"
        :aria-label="t('sales.workspace.dataPanel.button')"
        @click="dataOpen = true"
      >
        <UIcon name="i-lucide-chart-line" class="size-4 shrink-0" />
        <span class="[writing-mode:vertical-rl] text-sm font-medium tracking-wide">
          {{ t('sales.workspace.dataPanel.button') }}
        </span>
      </UButton>
    </div>
    </div>

    <!-- Narrow-mode panes: same headers + bodies as the splitter panes, but
         as full-height slideovers (only mounted below lg). -->
    <USlideover v-if="isNarrow" v-model:open="ordersSlideoverOpen">
      <template #content>
        <div class="flex flex-col h-full min-h-0">
          <SalesEventWorkspacePaneHeader
            icon="i-lucide-clipboard-list"
            :title="t('sales.orders.title')"
            @close="ordersSlideoverOpen = false"
          >
            <UChip :show="ordersFilterCount > 0" :text="ordersFilterCount" size="xl" inset>
              <UButton
                icon="i-lucide-filter"
                size="xs"
                color="neutral"
                :variant="ordersFiltersOpen ? 'soft' : 'ghost'"
                :aria-label="t('sales.workspace.filters')"
                @click="ordersFiltersOpen = !ordersFiltersOpen"
              />
            </UChip>
          </SalesEventWorkspacePaneHeader>
          <div class="flex-1 overflow-y-auto p-4 pt-2">
            <Suspense>
              <SalesEventWorkspaceOrdersTab
                v-model:filters-open="ordersFiltersOpen"
                :event="event"
                @update:active-filter-count="ordersFilterCount = $event"
              />
              <template #fallback>
                <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
              </template>
            </Suspense>
          </div>
        </div>
      </template>
    </USlideover>

    <USlideover
      v-if="isNarrow && event.requiresClient"
      v-model:open="clientsSlideoverOpen"
    >
      <template #content>
        <div class="flex flex-col h-full min-h-0">
          <SalesEventWorkspacePaneHeader
            icon="i-lucide-users"
            :title="t('sales.workspace.clientsPanel.title')"
            @close="clientsSlideoverOpen = false"
          />
          <div class="flex-1 overflow-y-auto p-4 pt-2">
            <SalesEventWorkspaceClientsPanel :event="event" />
          </div>
        </div>
      </template>
    </USlideover>

    <USlideover
      v-if="isNarrow && loggedIn"
      v-model:open="dataSlideoverOpen"
    >
      <template #content>
        <div class="flex flex-col h-full min-h-0">
          <SalesEventWorkspacePaneHeader
            icon="i-lucide-chart-line"
            :title="t('sales.workspace.dataPanel.title')"
            @close="dataSlideoverOpen = false"
          />
          <div class="flex-1 overflow-y-auto p-4 pt-2">
            <SalesEventWorkspaceDataPanel :event="event" :team-param="teamParam" />
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Narrow-mode settings: same surface as the panes. Opslaan lives in the
         slideover header (the inline header Save is desktop-only), driven by
         the same registered save API — only one SettingsTab instance ever
         mounts (the collapsible is gated on !isNarrow). -->
    <USlideover v-if="isNarrow" v-model:open="settingsSlideoverOpen">
      <template #content>
        <div class="flex flex-col h-full min-h-0">
          <SalesEventWorkspacePaneHeader
            icon="i-lucide-settings"
            :title="t('sales.events.settings')"
            @close="settingsSlideoverOpen = false"
          >
            <UButton
              size="xs"
              :loading="settingsSaving"
              :disabled="!settingsDirty"
              @click="settingsTab?.save()"
            >
              {{ t('sales.common.save') }}
            </UButton>
          </SalesEventWorkspacePaneHeader>
          <div class="flex-1 overflow-y-auto p-4 pt-3">
            <Suspense>
              <SalesEventWorkspaceSettingsTab :event="event" hide-save-bar tabbed @register="settingsTab = $event" />
              <template #fallback>
                <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
              </template>
            </Suspense>
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>
