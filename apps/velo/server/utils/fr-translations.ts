/**
 * Give every page a `fr` translation (#2762).
 *
 * French is velo's default locale, but the deploy seed upserts pages with
 * `translations = excluded.translations` (it REPLACES the column), and pages
 * created earlier only carry `nl`/`en`. Rather than listing slugs, derive the
 * missing `fr` entry from the page's own base fields.
 */
export interface PageTranslations {
  [locale: string]: { title?: string, slug?: string, content?: string, [k: string]: unknown } | undefined
}

/** Returns the merged translations, or `null` when `fr` already exists (nothing to do). */
export function withFrTranslation(
  page: { title?: string | null, slug?: string | null, content?: string | null },
  translations: PageTranslations | null | undefined
): PageTranslations | null {
  const current = translations ?? {}
  if (current.fr) return null
  return {
    ...current,
    fr: { title: page.title ?? '', slug: page.slug ?? '', content: page.content ?? '' }
  }
}
