import type { ComputedRef } from 'vue'

/**
 * Fetch one public page of Kasper's site through the crouton-pages public read
 * (`GET /api/teams/<team>/pages/<slug>?locale=<code>`), which already enforces
 * `status === 'published'` and the page's visibility (#4153).
 *
 * The team (`test1`) and the locale (`en`) only ever appear in the API URL,
 * never in a public address. Any fetch error (404 unknown/draft, 401/403
 * members-only, …) becomes a real Nuxt error, so page content is never
 * rendered on an error.
 */
export const SITE_TEAM = 'test1'
export const SITE_LOCALE = 'en'

export async function useSitePage(slug: string) {
  // Everything that needs the Nuxt instance (useFetch, useHead) is called
  // before the first `await` — after it, the composable context is gone.
  // The page shape is the renderer's own (not exported by crouton-pages), so
  // it stays loosely typed here.
  const request = useFetch<{ data: any }>(
    `/api/teams/${SITE_TEAM}/pages/${encodeURIComponent(slug)}`,
    {
      key: `site-page-${slug}`,
      query: { locale: SITE_LOCALE }
    }
  )
  const { data, error } = request

  const page = computed(() => data.value?.data ?? null)
  const title = computed<string>(() => {
    const p = page.value
    return p?.translations?.[SITE_LOCALE]?.title || p?.title || ''
  })

  // `<title>` is the page title alone — no team name suffix from the core
  // app's titleTemplate.
  useHead({ title, titleTemplate: '%s' })

  await request

  if (error.value || !page.value) {
    throw createError({
      statusCode: error.value?.statusCode || 404,
      statusMessage: 'Page not found',
      fatal: true
    })
  }

  return { page: page as ComputedRef<any>, title }
}
