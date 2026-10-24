<script setup lang="ts">
import type { NavigationMenuItem, DropdownMenuItem } from '@nuxt/ui'

/**
 * Pages Navigation Component
 *
 * Two-pill floating nav:
 * - Left pill: Page navigation links (hidden when only 1 page)
 * - Right pill: user/status pill, language switcher, dark mode toggle
 *
 * Responsive behavior:
 * - Desktop (md+): Full horizontal pills
 * - Mobile: Condensed pills with hamburger drawer for pages
 *
 * @example
 * <CroutonPagesNav />
 */

const { navigation, isLoading, isActive } = useNavigation()
const { currentTeam, isAdmin } = useTeam()
const { teamSlug: teamSlugRef, teamId: teamIdRef } = useTeamContext()
const { appsList, getAppAllRoutes } = useCroutonApps()
const { adminCollections } = useCroutonCollectionsNav()
const colorMode = useColorMode()
const { t } = useT()

// Mobile drawer state
const drawerOpen = ref(false)

// Close drawer when navigating (only for leaf items, not accordion expand)
const closeDrawer = () => {
  drawerOpen.value = false
}

// Transform navigation data to UNavigationMenu format
const menuItems = computed<NavigationMenuItem[]>(() => {
  if (!navigation.value) return []

  return navigation.value.map((item: any) => ({
    label: item.title || item.slug,
    icon: item.icon,
    to: item.path,
    active: isActive(item),
    onSelect: item.children?.length ? undefined : closeDrawer,
    children: item.children?.length
      ? item.children.map((child: any) => ({
          label: child.title || child.slug,
          icon: child.icon,
          to: child.path,
          onSelect: closeDrawer
        }))
      : undefined
  }))
})

// Team logo in the public header (#2259). Read from the shared site settings
// that crouton-admin's team-theme plugin loads (SSR) — no hard dependency.
const siteSettings = useState<Record<string, any> | null>('team-site-settings', () => null)
const teamLogo = computed<string | null>(() => siteSettings.value?.teamLogo || null)
const homePath = computed(() => (menuItems.value[0]?.to as string | undefined) ?? '/')

// Per-page chrome flags (set by the public page route from page.config —
// e.g. a volunteer-facing kassa page hides the member login). Language
// switcher and color-mode toggle are deliberately not hideable.
const pageChrome = useState<{ hideNav: boolean, hideAuthControls: boolean }>('pageChrome', () => ({ hideNav: false, hideAuthControls: false }))

// Show left pill only when more than 1 page and the page doesn't hide it
const showPageNav = computed(() => menuItems.value.length > 1 && !pageChrome.value.hideNav)

const toggleColorMode = () => {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

// Theme quick-select for the pill — a standalone palette dropdown wired to the
// SAME source as the CV-menu Theme submenu: the shared state key the
// crouton-themes base layer fills (empty when that layer isn't extended, so
// this renders nothing without a hard dependency on the themes package). The
// plugin stores a single "Theme ▸" submenu item; its children are the themes,
// which we surface directly as the dropdown's items. Gated on the same
// permission the CV menu uses (admins always; others when allowUserThemes).
const themePreferenceItems = useState<DropdownMenuItem[]>('crouton:themePreferenceItems', () => [])
const allowUserThemes = useState<boolean>('crouton:allowUserThemes', () => true)
const canSwitchTheme = computed(() => allowUserThemes.value || isAdmin.value)
const themeQuickItems = computed<DropdownMenuItem[][]>(() => {
  const children = (themePreferenceItems.value[0] as { children?: DropdownMenuItem[] } | undefined)?.children
  return canSwitchTheme.value && children?.length ? [children] : []
})

// Pill action slot — other layers push icon buttons here (e.g. pages' own
// "edit this page" pencil); rendered in the pill next to the appearance
// controls. See useCroutonNavPill.
const { visibleActions: navPillActions } = useCroutonNavPill()

// Admin menu items — mirrors AdminSidebar logic dynamically. Surfaced inside the
// user pill's menu as a "Manage site" submenu (admins only).
const adminPrefix = computed(() => {
  const teamParam = teamSlugRef.value || teamIdRef.value || currentTeam.value?.slug || ''
  return teamParam ? `/admin/${teamParam}` : '/admin'
})

const adminDropdownItems = computed<DropdownMenuItem[][]>(() => {
  const prefix = adminPrefix.value
  const groups: DropdownMenuItem[][] = []

  // Dashboard
  groups.push([
    {
      label: t('admin.dashboard'),
      icon: 'i-lucide-layout-dashboard',
      to: prefix
    }
  ])

  // Team section — same keys as AdminSidebar
  const teamPath = `${prefix}/team`
  groups.push([
    {
      label: t('teams.members'),
      icon: 'i-lucide-users',
      to: teamPath
    },
    {
      label: t('pages.admin.pages'),
      icon: 'i-lucide-file-text',
      to: `${prefix}/pages`
    },
    {
      label: t('teams.teamSettings'),
      icon: 'i-lucide-settings',
      to: `${teamPath}/settings`
    },
    {
      label: t('navigation.translations'),
      icon: 'i-lucide-languages',
      to: `${prefix}/translations`
    }
  ])

  // Collections — dynamic from useCroutonCollectionsNav()
  if (adminCollections.value.length > 0) {
    const basePath = `${prefix}/crouton`
    groups.push(
      adminCollections.value.map(col => ({
        label: col.label,
        icon: col.icon || 'i-lucide-database',
        to: `${basePath}/${col.name}`
      }))
    )
  }

  // App routes — dynamic from useCroutonApps()
  for (const app of appsList.value) {
    const allRoutes = getAppAllRoutes(app.id)
    if (allRoutes.length === 0) continue

    groups.push(
      allRoutes.map(appRoute => ({
        label: t(appRoute.label),
        icon: appRoute.icon,
        to: `${prefix}${appRoute.path}`
      }))
    )
  }

  return groups
})

const manageSiteItems = computed<DropdownMenuItem[]>(() =>
  isAdmin.value && currentTeam.value?.slug
    ? [{ label: t('pages.nav.manageSite'), icon: 'i-lucide-settings', children: adminDropdownItems.value }]
    : []
)

// Shared pill styles
// `pointer-events-auto` belongs HERE, on the visible pill — not on the wrapper's
// direct children (#1842). The wrapper spans the full viewport width when docked
// top (`inset-x-0`), and its child is only a flex row that right-aligns this
// pill. Re-enabling pointer events at that level put an invisible, full-width,
// z-50 click-catcher across the top of every page, swallowing clicks on whatever
// sat beneath it — the workspace pane headers' ✕ and filter buttons, in the
// report that found this.
const pillClass = 'pointer-events-auto flex items-center gap-1 bg-muted/80 backdrop-blur-sm rounded-full border border-default shadow-lg shadow-neutral-950/5'

// Full-screen pages (kassa and friends) own the whole viewport top — the
// pills dock to the bottom-left corner there instead of reserving a top
// strip. Same 'pageLayout' state the route publishes and the layout reads.
const pageLayout = useState<'default' | 'full-height' | 'full-screen'>('pageLayout', () => 'default')
const dockBottom = computed(() => pageLayout.value === 'full-screen')
</script>

<template>
  <!-- Mobile top hugs the viewport edge so the pill centers on a slim header
       line right under it (in portrait Safari the webview already starts
       below the status bar — env(safe-area-inset-top) is 0 there; the max()
       keeps it clear of the notch in standalone/PWA mode). -->
  <div
    class="fixed z-50 pointer-events-none"
    :class="dockBottom
      ? 'bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 sm:left-6'
      : 'top-[max(0.25rem,env(safe-area-inset-top))] sm:top-6 inset-x-0 px-4 sm:px-6'"
  >
    <!-- Loading state -->
    <template v-if="isLoading">
      <div class="relative flex items-center justify-center">
        <div :class="[pillClass, 'px-4 py-2']">
          <USkeleton class="h-6 w-16 rounded-full" />
          <USkeleton class="h-6 w-16 rounded-full" />
          <USkeleton class="h-6 w-16 rounded-full" />
        </div>
        <div :class="[pillClass, 'px-2 py-1 absolute right-0']">
          <USkeleton class="h-8 w-8 rounded-full" />
          <USkeleton class="h-6 w-12 rounded-full" />
          <USkeleton class="h-8 w-8 rounded-full" />
        </div>
      </div>
    </template>

    <!-- Desktop vs mobile is decided by CSS breakpoints (md = 768px), not JS:
         the server can't know the viewport, so a JS switch rendered the mobile
         wrapper on SSR and hydration kept its left alignment on desktop. -->
    <div
      v-else
      class="relative flex items-center"
      :class="dockBottom ? 'gap-2' : (showPageNav ? 'justify-start md:justify-center' : 'justify-end')"
    >
      <!-- Desktop: center pill with the page links (hidden when ≤1 page) -->
      <div v-if="showPageNav" :class="[pillClass, 'px-4 hidden md:flex']">
        <NuxtLink v-if="teamLogo" :to="homePath" class="shrink-0 flex items-center pe-2 me-1 border-e border-default">
          <img :src="teamLogo" :alt="currentTeam?.name || ''" class="h-6 w-auto max-w-28 object-contain">
        </NuxtLink>
        <UNavigationMenu
          :items="menuItems"
          variant="link"
          color="neutral"
          :ui="{
            link: 'px-2 py-1',
            linkLeadingIcon: 'hidden',
            childLinkLabel: 'whitespace-nowrap'
          }"
        />
      </div>

      <!-- Mobile: left pill with hamburger + popover nav (hidden when ≤1 page) -->
      <div v-if="showPageNav" :class="[pillClass, 'px-2 py-1 md:hidden']">
        <NuxtLink v-if="teamLogo" :to="homePath" class="shrink-0 flex items-center ps-1 pe-1">
          <img :src="teamLogo" :alt="currentTeam?.name || ''" class="h-6 w-auto max-w-24 object-contain">
        </NuxtLink>
        <UPopover v-model:open="drawerOpen" :content="{ side: 'bottom', align: 'start', sideOffset: 8 }">
          <UButton
            :icon="drawerOpen ? 'i-lucide-x' : 'i-lucide-menu'"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('pages.nav.openMenu')"
          />

          <template #content>
            <div class="p-1 min-w-48">
              <!-- Navigation links -->
              <NuxtLink
                v-for="item in menuItems"
                :key="item.label"
                :to="item.to"
                class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-highlighted hover:bg-elevated transition-colors"
                :class="item.active && 'bg-elevated font-medium'"
                @click="closeDrawer"
              >
                <UIcon v-if="item.icon" :name="item.icon" class="size-4 text-muted shrink-0" />
                {{ item.label }}
              </NuxtLink>

              <USeparator class="my-1" />

              <!-- Footer: language + dark mode -->
              <div class="flex items-center justify-between px-2 py-1">
                <CroutonI18nLanguageSwitcher class="w-auto" />
                <ClientOnly>
                  <UButton
                    :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="toggleColorMode"
                  />
                </ClientOnly>
              </div>
            </div>
          </template>
        </UPopover>
      </div>

      <!-- Right pill: auth controls (unless the page hides them) + language + dark mode (pinned right) -->
      <div :class="[pillClass, 'px-2 py-1', showPageNav && !dockBottom && 'absolute right-0']">
        <ClientOnly>
          <CroutonUserPill placement="inline" use-modal :extra-items="manageSiteItems" />
          <USeparator orientation="vertical" class="h-5 md:mx-1" />
        </ClientOnly>

        <!-- Package-contributed pill actions (e.g. the edit-page pencil).
             Client-only: actions are registered on mount. -->
        <ClientOnly>
          <UButton
            v-for="action in navPillActions"
            :key="action.id"
            :icon="action.icon"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="action.label"
            @click="action.onSelect"
          />
        </ClientOnly>

        <!-- Language Switcher -->
        <CroutonI18nLanguageSwitcher class="w-auto" />

        <!-- Theme quick-select — only when the themes package populates the
             shared items (client-only, so no SSR hydration mismatch). -->
        <ClientOnly>
          <UDropdownMenu v-if="themeQuickItems.length" :items="themeQuickItems">
            <UButton
              icon="i-lucide-palette"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('pages.nav.theme')"
            />
          </UDropdownMenu>
        </ClientOnly>

        <!-- Dark/Light Mode Toggle -->
        <ClientOnly>
          <UButton
            :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="toggleColorMode"
          />
        </ClientOnly>
      </div>
    </div>

    <!-- Account Settings Modal -->
    <AccountSettingsModal />
  </div>
</template>
