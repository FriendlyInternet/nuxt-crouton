<script setup lang="ts">
/**
 * Public Page Route with Locale
 *
 * Renders pages at /[team]/[locale]/[slug] URLs.
 * Supports custom domains via domain resolver middleware.
 *
 * URL patterns:
 * - /acme/en/about-us → team=acme, locale=en, slug=about-us
 * - /acme/fr/a-propos → team=acme, locale=fr, slug=a-propos
 * - /acme/nl/over-ons → team=acme, locale=nl, slug=over-ons
 *
 * Layout modes:
 * - default: Normal scrollable content with padding
 * - full-height: Fixed viewport height, content fills remaining space
 * - full-screen: No padding, full viewport
 *
 * Inline editing:
 * - Admins see a floating edit button (FAB) at bottom-right
 * - Clicking it opens a side-by-side editor via the public layout
 * - Live preview updates as the admin edits translations
 */
definePageMeta({
  layout: 'public',
  // Validate route params BEFORE setup runs. This prevents "$setup.t is not a
  // function" SSR errors caused by throwing createError() inside async setup
  // (the rejected promise is detected by Node before Nuxt's Suspense catches it).
  validate: async (route) => {
    const reservedPrefixes = ['auth', 'api', 'admin', 'dashboard', '_nuxt', '__nuxt']
    const teamParam = route.params.team as string

    // Reject reserved prefixes and file-like paths (e.g., favicon.svg, robots.txt)
    if (!teamParam || reservedPrefixes.includes(teamParam) || teamParam.includes('.')) {
      return false
    }

    // Verify team actually exists to avoid catching routes meant for other pages
    try {
      const { valid } = await $fetch<{ valid: boolean }>(`/api/crouton-pages/validate-team/${teamParam}`)
      return valid
    } catch {
      return false
    }
  }
})

// Cache public pages for 1 hour (SWR: serve stale while regenerating in background)
// Nuxt 4.3: payload extraction means SPA navigation also uses cached payload
defineRouteRules({ swr: 3600 })

// Share page layout with the layout component via useState (works across components)
const pageLayout = useState<'default' | 'full-height' | 'full-screen'>('pageLayout', () => 'default')

const route = useRoute()
const { teamId } = useTeamContext()
const { t } = useT()
const { getPageType } = usePageTypes()
const { isCustomDomain, hideTeamInUrl } = useDomainContext()

// i18n for locale handling and SEO
const { locale: i18nLocale, locales, setLocale } = useI18n()

// Get team, locale, and slug from route params
const team = computed(() => teamId.value || null)
const urlLocale = computed(() => route.params.locale as string)
const slug = computed(() => {
  const slugParts = route.params.slug
  if (!slugParts || (Array.isArray(slugParts) && slugParts.length === 0)) {
    return '' // Homepage
  }
  return Array.isArray(slugParts) ? slugParts.join('/') : slugParts
})

// Validate locale — if invalid, show 404 without throwing (avoids SSR unhandledRejection)
const validLocales = computed(() => locales.value.map((l: { code: string }) => l.code))
const isValidLocale = computed(() => validLocales.value.includes(urlLocale.value))

if (!isValidLocale.value) {
  showError({ statusCode: 404, statusMessage: 'Page Not Found' })
}

// Sync URL locale with i18n locale
if (urlLocale.value !== i18nLocale.value) {
  setLocale(urlLocale.value as any)
}

// Build API URL - slug might be empty for homepage
const apiUrl = computed(() => {
  const baseUrl = `/api/teams/${team.value}/pages`
  // Always use slug endpoint - use '_home' for homepage (empty slug)
  // The API handles '_home' as "get first published root page"
  return `${baseUrl}/${slug.value || '_home'}`
})

// Fetch page by team and slug, passing current locale for translated slug lookup
const { data: pageResponse, status, error, refresh } = await useFetch(apiUrl, {
  query: { locale: urlLocale },
  watch: [team, slug, urlLocale],
  transform: (data: any) => data
})

// Extract page and meta from response
const page = computed(() => pageResponse.value?.data)
const pageMeta = computed(() => pageResponse.value?.meta)

// Get page type info (needed for layout fallback)
const pageType = computed(() => {
  if (!page.value) return null
  return getPageType(page.value.pageType || 'core:regular')
})

// Compute the desired layout based on page data
const desiredLayout = computed(() => {
  const p = page.value
  const pt = pageType.value

  if (p?.layout && p.layout !== 'default') {
    return p.layout as 'default' | 'full-height' | 'full-screen'
  } else if ((pt as any)?.preferredLayout) {
    return (pt as any).preferredLayout as 'default' | 'full-height' | 'full-screen'
  }
  return 'default'
})

// Set layout whenever desiredLayout changes (handles SSR, hydration, and navigation)
watch(desiredLayout, (layout) => {
  pageLayout.value = layout
}, { immediate: true })

// Handle errors — use showError instead of throw to avoid SSR unhandledRejection
if (error.value?.statusCode === 404) {
  showError({ statusCode: 404, statusMessage: 'Page Not Found' })
}

// Scoped (access-code) pages announce their required scope in the 401 payload —
// render the PIN gate inline instead of bouncing to the member login.
const scopedGate = computed<{ teamId: string, scope: { resourceType?: string, resourceId?: string, nameRequired?: boolean }, chrome?: { hideNav?: boolean, hideAuthControls?: boolean } } | null>(() => {
  if (error.value?.statusCode !== 401) return null
  const payload: any = (error.value as any)?.data?.data ?? (error.value as any)?.data
  return payload?.reason === 'scoped' ? payload : null
})

// Per-page chrome: pages can hide the nav pill and/or the login/account
// controls via config flags (e.g. a volunteer-facing kassa page). Shared
// with CroutonPagesNav via useState — same pattern as pageLayout. The
// language switcher and color-mode toggle always stay reachable. On a gated
// scoped page the flags come from the 401 payload so the gate is chrome-less
// too.
const pageChrome = useState<{ hideNav: boolean, hideAuthControls: boolean }>('pageChrome', () => ({ hideNav: false, hideAuthControls: false }))

watchEffect(() => {
  let cfg: any = null
  try {
    cfg = typeof page.value?.config === 'string' ? JSON.parse(page.value.config) : page.value?.config
  } catch {
    cfg = null
  }
  const src = cfg ?? scopedGate.value?.chrome ?? {}
  pageChrome.value = {
    hideNav: !!src.hideNav,
    // While the access-code gate is shown, always hide the member-login button:
    // the gate has its own "Team member? Log in" door, so a second nav login
    // button only sends volunteers into the member auth dead-end.
    hideAuthControls: !!src.hideAuthControls || !!scopedGate.value
  }
})

onBeforeUnmount(() => {
  pageChrome.value = { hideNav: false, hideAuthControls: false }
})

// Handle 401 - redirect to login for members/admin-only pages
if (error.value?.statusCode === 401 && !scopedGate.value) {
  navigateTo(`/auth/login?redirect=${encodeURIComponent(route.fullPath)}`)
}

// Check authentication for protected pages
const { user } = useSession()

// Redirect if auth required but user not logged in
watchEffect(() => {
  if ((pageType.value as any)?.requiresAuth && !user.value) {
    navigateTo(`/auth/login?redirect=${encodeURIComponent(route.fullPath)}`)
  }
})

// --- Inline editing ---

// Admin detection (useTeam may not be available if auth package not installed)
let isAdmin = ref(false)
try {
  const teamComposable = useTeam()
  isAdmin = teamComposable.isAdmin
} catch {
  // Auth package not installed or useTeam unavailable
}

// Shared editing state with layout
const isEditing = useState<boolean>('pageEditing', () => false)
const editingPageId = useState<string | null>('editingPageId', () => null)

// Shared translations from the editor for live preview
const editingTranslations = useState<Record<string, any> | null>('editingTranslations', () => null)

// Compute the page data to render — uses editor translations for live preview when editing
const previewPage = computed(() => {
  if (isEditing.value && editingTranslations.value && page.value) {
    return { ...page.value, translations: editingTranslations.value }
  }
  return page.value
})

function startEditing() {
  if (!page.value?.id) return
  editingPageId.value = page.value.id
  isEditing.value = true
}

// Contribute the "edit this page" pencil to the nav pill (replaces the old
// floating FAB). Client-side registration — actions carry functions, so they
// must not be serialized through SSR. Visibility tracks admin + not-editing +
// a real page.
const { register: registerNavAction } = useCroutonNavPill()
let offNavAction: (() => void) | null = null
onMounted(() => {
  offNavAction = registerNavAction({
    id: 'pages:edit-page',
    icon: 'i-lucide-pencil',
    label: t('pages.admin.editPage', 'Edit Page'),
    order: 100,
    onSelect: startEditing,
    show: () => isAdmin.value && !isEditing.value && !!page.value?.id
  })
})

// Refresh page data after save
watch(isEditing, async (editing, wasEditing) => {
  if (!editing && wasEditing) {
    // Editor was closed — refresh page data to pick up saved changes
    await refresh()
  }
})

// Clean up editing state on unmount
onBeforeUnmount(() => {
  offNavAction?.()
  isEditing.value = false
  editingPageId.value = null
  editingTranslations.value = null
})

// Site URL for absolute Open Graph URLs
const { croutonPages } = useRuntimeConfig().public as { croutonPages: { siteUrl: string } }
const siteUrl = croutonPages.siteUrl || ''

function toAbsoluteUrl(url: string | undefined | null, base: string): string | undefined {
  if (!url) return undefined
  if (url.startsWith('http')) return url
  return `${base}${url}`
}

// Canonical nested slug path for the current locale (e.g. "events/summer-fair"),
// resolved server-side. Falls back to the leaf slug if meta is unavailable.
const canonicalPath = computed(() => pageMeta.value?.fullPath ?? page.value?.slug ?? '')
const localePrefixFor = (loc: string) => `${hideTeamInUrl.value ? '' : `/${team.value}`}/${loc}`
const buildSeoUrl = (loc: string, path: string) =>
  `${siteUrl}${localePrefixFor(loc)}/${path}`.replace(/\/+$/, '') || `${siteUrl}${localePrefixFor(loc)}`

// SEO meta (server-only — crawlers read SSR HTML)
useServerSeoMeta({
  title: page.value?.seoTitle || page.value?.title || 'Page',
  description: page.value?.seoDescription || undefined,
  // Open Graph
  ogTitle: page.value?.seoTitle || page.value?.title || 'Page',
  ogDescription: page.value?.seoDescription || undefined,
  ogImage: toAbsoluteUrl(page.value?.ogImage, siteUrl),
  ogUrl: buildSeoUrl(urlLocale.value, canonicalPath.value),
  ogType: 'website',
  // Twitter Card
  twitterCard: page.value?.ogImage ? 'summary_large_image' : 'summary',
  twitterTitle: page.value?.seoTitle || page.value?.title || 'Page',
  twitterDescription: page.value?.seoDescription || undefined,
  twitterImage: toAbsoluteUrl(page.value?.ogImage, siteUrl),
  // Robots
  robots: page.value?.robots === 'noindex' ? 'noindex, nofollow' : undefined
})

// Build hreflang links for SEO
const alternateLinks = computed(() => {
  const translations = pageMeta.value?.translations
  if (!translations || !page.value) return []

  // Parse translations if string
  const parsedTranslations = typeof translations === 'string'
    ? JSON.parse(translations)
    : translations

  // Get base slug (English slug)
  const baseSlug = page.value.baseSlug || page.value.slug

  // Ancestor prefix of the nested path (everything but the leaf), reused across
  // locales. Ancestor slugs are kept in the current locale — only the page's own
  // leaf slug is swapped per locale, which is all this page's translations carry.
  const ancestorPrefix = canonicalPath.value.split('/').slice(0, -1).join('/')

  // Build alternate links for each locale: /team/locale/{ancestors}/{leaf}
  return locales.value.map((loc: { code: string }) => {
    const translatedSlug = parsedTranslations?.[loc.code]?.slug || baseSlug
    const localePath = ancestorPrefix ? `${ancestorPrefix}/${translatedSlug}` : translatedSlug
    return {
      rel: 'alternate',
      hreflang: loc.code,
      href: buildSeoUrl(loc.code, localePath)
    }
  })
})

// Page title and hreflang links for head
useHead({
  title: () => page.value?.title || 'Page',
  link: () => [
    // Canonical URL (absolute)
    {
      rel: 'canonical',
      href: buildSeoUrl(urlLocale.value, canonicalPath.value)
    },
    // hreflang alternatives
    ...alternateLinks.value
  ]
})
</script>

<template>
  <div class="page-view h-full">
    <!-- Loading -->
    <div v-if="status === 'pending'" class="flex justify-center items-center py-24">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-primary" />
    </div>

    <!-- Page content -->
    <template v-else-if="page">
      <CroutonPagesRenderer :page="previewPage" />
    </template>

    <!-- Scoped page without a token: inline access-code gate -->
    <CroutonPagesScopedAccessGate
      v-else-if="scopedGate"
      :team-id="scopedGate.teamId"
      :scope="scopedGate.scope"
      @unlocked="refresh()"
    />

    <!-- Error / Not found -->
    <template v-else>
      <div class="text-center py-24">
        <UIcon name="i-lucide-file-x" class="size-16 text-muted mb-6 mx-auto" />
        <h2 class="text-2xl font-semibold mb-2">{{ t('pages.notFound') || 'Page not found' }}</h2>
        <p class="text-muted mb-6">{{ t('pages.notFoundDescription') || 'The page you are looking for does not exist.' }}</p>
        <UButton :to="hideTeamInUrl ? '/' : `/${team}/${urlLocale}`" color="primary">
          <UIcon name="i-lucide-home" class="mr-2" />
          {{ t('pages.backToHome') || 'Back to Home' }}
        </UButton>
      </div>
    </template>

    <!-- The "edit this page" pencil now lives in the nav pill (registered via
         useCroutonNavPill in the script), not a floating FAB. -->
  </div>
</template>
