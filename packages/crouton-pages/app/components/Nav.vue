<script setup lang="ts">
import type { NavigationMenuItem, DropdownMenuItem } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'

/**
 * Pages Navigation Component
 *
 * Two-pill floating nav:
 * - Left pill: Page navigation links (hidden when only 1 page)
 * - Right pill: User menu (or login link), language switcher, dark mode toggle
 *
 * Responsive behavior:
 * - Desktop (md+): Full horizontal pills
 * - Mobile: Condensed pills with hamburger drawer for pages
 *
 * @example
 * <CroutonPagesNav />
 */

const { navigation, isLoading, isActive } = useNavigation()
const { user, userInitials, dropdownItems: userDropdownItems } = useUserMenuItems({ useModal: true })
const { currentTeam, isAdmin } = useTeam()
const { teamSlug: teamSlugRef, teamId: teamIdRef } = useTeamContext()
const { appsList, getAppAllRoutes } = useCroutonApps()
const { adminCollections } = useCroutonCollectionsNav()
const colorMode = useColorMode()
const { t } = useT()

// Responsive breakpoint
const isDesktop = useMediaQuery('(min-width: 768px)')

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

// Per-page chrome flags (set by the public page route from page.config —
// e.g. a volunteer-facing kassa page hides the member login). Language
// switcher and color-mode toggle are deliberately not hideable.
const pageChrome = useState<{ hideNav: boolean, hideAuthControls: boolean }>('pageChrome', () => ({ hideNav: false, hideAuthControls: false }))

// Show left pill only when more than 1 page and the page doesn't hide it
const showPageNav = computed(() => menuItems.value.length > 1 && !pageChrome.value.hideNav)

// Login button / user avatar / admin menu visibility
const showAuthControls = computed(() => !pageChrome.value.hideAuthControls)

// Scoped visitor session (e.g. a kassa volunteer who redeemed a PIN). Published
// by the owning addon (crouton-sales) into shared state — display-only here.
// Shown even when member auth controls are hidden: it's the visitor's *own*
// session, and `hideAuthControls` only hides the team-member login. Logout is
// the addon's full teardown, fired via a hook so we stay package-agnostic.
// Member login returns to the current page (otherwise you land on /auth/login
// with no way back to a kassa / scoped page).
// dismissible=1 → on a normal public page the member-login modal can be
// closed back to the page (there's content behind it). Hard members/admin
// 401s open the modal without this flag, staying non-dismissable.
const route = useRoute()
const loginUrl = computed(() => `/auth/login?redirect=${encodeURIComponent(route.fullPath)}&dismissible=1`)

const scopedSession = useState<{ displayName: string } | null>('crouton:scoped-session', () => null)
async function logoutScopedSession() {
  await (useNuxtApp().hooks as any).callHook('crouton:scoped-session:logout')
  // Re-gate: a scoped page without a session must fall back to its access gate,
  // so re-login is the PIN (not the member email/password form). A full reload
  // re-runs the SSR scope check (the token was revoked server-side).
  reloadNuxtApp({ force: true })
}

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

// Admin dropdown menu items — mirrors AdminSidebar logic dynamically
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

// Shared pill styles
const pillClass = 'flex items-center gap-1 bg-muted/80 backdrop-blur-sm rounded-full border border-default shadow-lg shadow-neutral-950/5'

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
    class="fixed z-50 pointer-events-none [&>*]:pointer-events-auto"
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

    <!-- Desktop layout -->
    <div v-else-if="isDesktop" class="relative flex items-center" :class="dockBottom ? 'gap-2' : (showPageNav ? 'justify-center' : 'justify-end')">
      <!-- Center pill: Page navigation (hidden when ≤1 page) -->
      <div v-if="showPageNav" :class="[pillClass, 'px-4']">
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

      <!-- Right pill: User menu + language + dark mode (pinned right) -->
      <div :class="[pillClass, 'px-2 py-1', showPageNav && !dockBottom && 'absolute right-0']">
        <ClientOnly>
          <template v-if="showAuthControls">
            <!-- Authenticated: Avatar dropdown -->
            <UDropdownMenu
              v-if="user"
              :items="userDropdownItems"
              :content="{ align: 'end', side: 'bottom' }"
              :ui="{ content: 'w-56' }"
            >
              <UButton
                variant="ghost"
                color="neutral"
                size="sm"
                class="rounded-full"
              >
                <template #leading>
                  <UAvatar
                    :src="user?.image ?? undefined"
                    :alt="user?.name ?? 'User'"
                    :text="userInitials"
                    size="2xs"
                  />
                </template>
              </UButton>
            </UDropdownMenu>

            <!-- Not authenticated: Login button (suppressed when a scoped
                 visitor session is active — they're already signed in). -->
            <UButton
              v-else-if="!scopedSession"
              :to="loginUrl"
              icon="i-lucide-log-in"
              color="neutral"
              variant="ghost"
              size="sm"
              :label="t('auth.signIn')"
            />

            <!-- Admin menu -->
            <UDropdownMenu
              v-if="user && isAdmin && currentTeam?.slug"
              :items="adminDropdownItems"
              :content="{ align: 'end', side: 'bottom' }"
              :ui="{ content: 'w-48' }"
            >
              <UButton
                icon="i-lucide-settings"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Admin menu"
              />
            </UDropdownMenu>

            <!-- Divider only when the member section actually rendered something. -->
            <USeparator v-if="user || !scopedSession" orientation="vertical" class="h-5 mx-1" />
          </template>
        </ClientOnly>

        <!-- Scoped visitor session (e.g. a kassa volunteer). Their own session,
             so it shows even when member auth controls are hidden; never
             alongside a member avatar (`!user`). -->
        <ClientOnly>
          <template v-if="scopedSession && !user">
            <span class="text-sm text-muted max-w-28 truncate">{{ scopedSession.displayName }}</span>
            <UButton
              icon="i-lucide-log-out"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('pages.nav.signOut')"
              @click="logoutScopedSession"
            />
            <USeparator orientation="vertical" class="h-5 mx-1" />
          </template>
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

    <!-- Mobile layout -->
    <div v-else class="relative flex items-center" :class="showPageNav ? 'justify-start' : 'justify-end'">
      <!-- Left pill: Hamburger + popover nav (hidden when ≤1 page) -->
      <div v-if="showPageNav" :class="[pillClass, 'px-2 py-1']">
        <UPopover v-model:open="drawerOpen" :content="{ side: 'bottom', align: 'start', sideOffset: 8 }">
          <UButton
            :icon="drawerOpen ? 'i-lucide-x' : 'i-lucide-menu'"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Open navigation menu"
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

      <!-- Right pill: auth controls (unless the page hides them) + language + dark mode -->
      <div :class="[pillClass, 'px-2 py-1', showPageNav && !dockBottom && 'absolute right-0']">
        <ClientOnly>
          <template v-if="showAuthControls">
            <!-- Authenticated: Avatar dropdown -->
            <template v-if="user">
              <UDropdownMenu
                :items="userDropdownItems"
                :content="{ align: 'end', side: 'bottom' }"
                :ui="{ content: 'w-56' }"
              >
                <UButton
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  class="rounded-full"
                >
                  <template #leading>
                    <UAvatar
                      :src="user?.image ?? undefined"
                      :alt="user?.name ?? 'User'"
                      :text="userInitials"
                      size="2xs"
                    />
                  </template>
                </UButton>
              </UDropdownMenu>

              <!-- Admin menu -->
              <UDropdownMenu
                v-if="isAdmin && currentTeam?.slug"
                :items="adminDropdownItems"
                :content="{ align: 'end', side: 'bottom' }"
                :ui="{ content: 'w-48' }"
              >
                <UButton
                  icon="i-lucide-settings"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="Admin menu"
                />
              </UDropdownMenu>
            </template>

            <!-- Not authenticated: Login button (suppressed for scoped visitors). -->
            <UButton
              v-else-if="!scopedSession"
              :to="loginUrl"
              icon="i-lucide-log-in"
              color="neutral"
              variant="ghost"
              size="sm"
            />

            <USeparator v-if="user || !scopedSession" orientation="vertical" class="h-5" />
          </template>
        </ClientOnly>

        <!-- Scoped visitor session — own session, shown even on chrome-less
             pages; never alongside a member avatar (`!user`). -->
        <ClientOnly>
          <template v-if="scopedSession && !user">
            <span class="text-sm text-muted max-w-24 truncate">{{ scopedSession.displayName }}</span>
            <UButton
              icon="i-lucide-log-out"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('pages.nav.signOut')"
              @click="logoutScopedSession"
            />
            <USeparator orientation="vertical" class="h-5" />
          </template>
        </ClientOnly>

        <!-- Language + theme + dark mode — always reachable, even on chrome-less pages -->
        <CroutonI18nLanguageSwitcher class="w-auto" />

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
