<script setup lang="ts">
/**
 * Event Workspace Block Public Renderer
 *
 * One block, faces by session — and, for members, by viewport:
 *
 *   member on a wide screen →  the full workspace shell INLINE (kassa +
 *                              settings / orders / clients panes; event fixed
 *                              by the editor, so the switcher is hidden)
 *   member on a phone/tablet → an "Open kassa" launcher that opens that SAME
 *                              workspace shell in a fullscreen modal — the
 *                              inline shell is cramped boxed inside a scrolling
 *                              CMS page on small screens (<lg, matching Shell's
 *                              own breakpoint)
 *   anonymous / volunteer →    an "Open kassa" launcher that opens the POS
 *                              (<SalesPosPanel>) in a fullscreen modal
 *
 * Why a launcher + modal (not an inline or `fixed inset-0` panel): the block
 * lives inside a normal scrollable CMS page and can sit beside other blocks
 * (a QR code, a button row). A `fixed inset-0` takeover left those siblings
 * scrollable behind it, which iOS Safari rubber-bands ("the page scrolls
 * while it doesn't"). UModal's Reka dialog locks the page scroll properly,
 * portals to <body>, and is iOS-reliable — and the launch is explicit, so
 * the public page stays a clean, ordinary in-flow page. The launcher (this
 * "kassa opening module") owns the helper session display + logout; the
 * modal is a pure ordering surface with just a close button.
 *
 * The member shell does a top-level `await`, so it gets a local <Suspense>
 * (BlockContent.vue wraps us in <ClientOnly>, which is not a Suspense
 * boundary) — in both the inline and the modal mount. The panel loads
 * client-side, so it needs none.
 */
interface EventWorkspaceAttrs {
  eventSlug?: string
  /**
   * @deprecated The volunteer kassa is now a fullscreen modal launched on
   * demand, not an inline panel — height no longer applies. Kept so stored
   * `height` attrs on existing nodes don't break.
   */
  height?: 'compact' | 'tall' | 'fill'
}

const props = defineProps<{ attrs: EventWorkspaceAttrs }>()

const { t } = useT()
const { loggedIn } = useAuth()

const eventSlug = computed(() => props.attrs.eventSlug || '')

// Members get the workspace inline only on a wide screen. Below lg (the same
// breakpoint Shell uses to drop its side-by-side panes) the inline shell is
// cramped inside the scrolling CMS page, so members fall through to the same
// launcher → fullscreen modal as volunteers — but the modal hosts the full
// shell, not just the POS. clientOnly wrapper ⇒ matchMedia is read on mount,
// so there's no SSR/hydration flash.
const isNarrow = useMediaQuery('(max-width: 1023px)')
const showInlineShell = computed(() => loggedIn.value && !isNarrow.value)

// The kassa opens in a fullscreen modal — the shell/panel mounts (and fetches)
// on first open. The helper session indicator + logout live in the page nav's
// auth pill (the scoped-session-nav plugin bridges them), not here.
const kassaOpen = ref(false)

// Member quick access on the launcher: a card opens ONLY its pane (PaneHost
// in its own fullscreen modal) — never the kassa behind it. "Open kassa" is
// the kassa's own entry.
const paneOpen = ref(false)
const activePane = ref<'orders' | 'clients' | 'data' | 'settings'>('orders')

function openPane(pane: 'orders' | 'clients' | 'data' | 'settings') {
  activePane.value = pane
  paneOpen.value = true
}
</script>

<template>
  <div class="event-workspace-block">
    <!-- Editor didn't pick an event -->
    <UAlert
      v-if="!eventSlug"
      color="neutral"
      variant="soft"
      icon="i-lucide-store"
      :title="t('sales.block.noEventPicked')"
    />

    <!-- Wide-screen team member → the full workspace inline (event fixed, no
         switcher). Bare — the shell's kassa module draws its own border, so a
         card wrapper doubled the frame (card border + module border) and its
         body padding ate kassa height. -->
    <Suspense v-else-if="showInlineShell">
      <SalesEventWorkspaceShell :event-slug="eventSlug" :show-switcher="false" />
      <template #fallback>
        <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
      </template>
    </Suspense>

    <!-- Otherwise → "Open kassa" launcher + fullscreen modal. Two cases: a
         member on a narrow screen (modal hosts the full workspace shell), or an
         anonymous volunteer (modal hosts the POS panel). The session indicator
         + logout live in the page nav's auth pill, not here. -->
    <template v-else>
      <UCard :ui="{ body: 'flex flex-col items-center gap-5 text-center' }">
        <p class="text-sm text-muted">{{ t('sales.block.openKassaHint') }}</p>
        <UButton size="xl" block class="max-w-md" @click="kassaOpen = true">
          {{ loggedIn ? t('sales.block.openKassa') : t('sales.block.makeOrder') }}
        </UButton>
        <!-- Member quick access: one explained card per workspace surface,
             each with a live headline number — straight into that pane, one
             tap instead of two. Volunteers (no session) get only the big
             button. -->
        <SalesBlocksEventWorkspaceLauncherCards
          v-if="loggedIn"
          :event-slug="eventSlug"
          class="max-w-md"
          @open="openPane($event)"
        />
      </UCard>

      <!-- Pane deep-entry: just the pane, in its own fullscreen surface —
           the kassa is never mounted behind it. -->
      <UModal v-if="loggedIn" v-model:open="paneOpen" fullscreen :ui="{ content: 'bg-default' }">
        <template #content>
          <div class="flex flex-col h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <Suspense>
              <SalesEventWorkspacePaneHost
                :event-slug="eventSlug"
                :pane="activePane"
                @close="paneOpen = false"
              />
              <template #fallback>
                <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
              </template>
            </Suspense>
          </div>
        </template>
      </UModal>

      <UModal v-model:open="kassaOpen" fullscreen :ui="{ content: 'bg-default' }">
        <template #content>
          <!-- Safe-area padding: the content is fixed inset-0, so keep the
               header off the notch and the cart bar above Safari's bottom bar
               (env() needs viewport-fit=cover — set by the viewport-meta plugin). -->
          <div class="flex flex-col h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <!-- Member (narrow) → the full workspace shell. Its top row (the
                 strip on narrow, the header on wide) carries the exit ✕
                 (closable) — no separate close row wasting a line. -->
            <template v-if="loggedIn">
              <!-- No inset padding: the shell runs edge-to-edge in the modal
                   (fill) — a p-4 wrapper + the shell's own border frame made
                   the kassa read as a boxed panel rather than full-screen. -->
              <div class="flex-1 min-h-0">
                <Suspense>
                  <SalesEventWorkspaceShell
                    :event-slug="eventSlug"
                    :show-switcher="false"
                    :show-strip="false"
                    fill
                    closable
                    @close="kassaOpen = false"
                  />
                  <template #fallback>
                    <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
                  </template>
                </Suspense>
              </div>
            </template>

            <!-- Volunteer → pure ordering surface (its own close button). -->
            <SalesPosPanel
              v-else
              :event-slug="eventSlug"
              closable
              class="flex-1 min-h-0"
              @close="kassaOpen = false"
            />
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
