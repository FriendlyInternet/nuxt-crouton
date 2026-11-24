<script setup lang="ts">
/**
 * CroutonTabsPanel — the shared shell for a tabbed admin section (Team, Bookings,
 * Sales…): ONE top bar holding the sidebar toggle, the section title and the
 * section's tabs, with the active tab's page below it (#2380).
 *
 * - Phone: menu button + tabs on one row; the title is screen-reader only.
 *   Tabs keep their full labels and swipe sideways when they don't fit.
 * - Desktop: title + tabs on the same row.
 * - The body adds NO padding. Pages own their gutter and use `p-4 sm:p-6`
 *   (CroutonCollectionViewer already does) so content lines up with the top
 *   bar's own 16/24px inset.
 *
 * Usage (in a section's parent route):
 *   <CroutonTabsPanel :title="t('bookings.admin.sectionTitle')" :tabs="tabs">
 *     <NuxtPage />
 *   </CroutonTabsPanel>
 */
import type { NavigationMenuItem } from '@nuxt/ui'

// On a phone the active tab can sit off-screen (e.g. the last tab) — bring it into view.
// The row's width is only final after layout, so react to its size (first observation
// included) rather than to mount, plus to each route change once it has rendered.
const tabsEl = useTemplateRef<HTMLElement>('tabsEl')
const route = useRoute()

function revealActiveTab() {
  const active = tabsEl.value?.querySelector<HTMLElement>('[aria-current="page"]')
  active?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}

useResizeObserver(tabsEl, revealActiveTab)
watch(() => route.path, revealActiveTab, { flush: 'post' })

const props = withDefaults(defineProps<{
  /** Section name — shown on desktop, screen-reader only on phones. */
  title: string
  /** The section's tabs (usually `{ label, icon, to }`, `exact` on the index tab), flat or grouped. */
  tabs: NavigationMenuItem[] | NavigationMenuItem[][]
  /** Max width of the content column (left-aligned, so it shares the bar's edge). */
  maxWidth?: string
  /** Opt-in: bound the body to the panel height (page owns its scrolling) instead of scrolling the whole body. */
  fill?: boolean
}>(), {
  maxWidth: 'max-w-5xl',
  fill: false
})

const panelUi = computed(() => ({
  body: props.fill ? 'p-0 sm:p-0 gap-0 sm:gap-0 overflow-hidden' : 'p-0 sm:p-0 gap-0 sm:gap-0'
}))
</script>

<template>
  <UDashboardPanel :ui="panelUi">
    <template #header>
      <UDashboardNavbar
        :title="title"
        :ui="{ left: 'flex-1 self-stretch', title: 'max-sm:sr-only shrink-0 sm:me-2' }"
      >
        <template #leading>
          <UDashboardSidebarCollapse class="hidden lg:flex" />
        </template>

        <template #trailing>
          <!-- Full bar height so the active underline sits on the bar's bottom edge.
               Scrolls sideways only — SCROLL_ROW_X (app/utils/scroll-row.ts, #2399/#4330). -->
          <div
            ref="tabsEl"
            class="flex-1 min-w-0 self-stretch [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            :class="SCROLL_ROW_X"
          >
            <UNavigationMenu
              :items="tabs"
              orientation="horizontal"
              highlight
              highlight-color="primary"
              class="h-full min-w-max"
              :ui="{
                root: '[&>div]:h-full',
                list: 'h-full',
                item: 'h-full py-0',
                // the hover pill keeps its normal height inside the full-height link
                link: 'h-full py-0 before:inset-y-3 after:bottom-0 after:h-0.5'
              }"
            />
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        class="w-full"
        :class="[maxWidth, fill && 'flex-1 min-h-0 flex flex-col']"
      >
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
