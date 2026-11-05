/**
 * The payload the page editor sends to the API (#2322, slice 1 of #1640).
 *
 * Pure: form state in, request body out. This used to be the body of `Editor.vue`'s
 * `handleSubmit` (111 lines, Fallow CRAP 992); the component now only validates, calls this,
 * and sends. Everything it decides is pinned in `test/page-submit-data.test.ts`.
 *
 * Why an explicit allowlist (#1403): never spread the whole record. Identity, ownership,
 * hierarchy and audit fields (`id`, `teamId`, `owner`, `path`, `depth`, `createdBy`, the
 * `*User` joins …) must not ride along, and untouched fields shouldn't be re-asserted beyond
 * what the form actually presents.
 */
type Translation = { title?: string; slug?: string; content?: unknown; seoTitle?: string; seoDescription?: string }
type Translations = Record<string, Translation>

export interface PageSubmitInput {
  /** The editor's form state (a page record, possibly with joins and audit fields). */
  state: Record<string, any>
  /** Block editor is the active content surface — its content wins over the root column. */
  showBlockEditor: boolean
  /** Regular pages keep only page-level config flags; every other type passes config through. */
  isRegularPage: boolean
  /** Live collab fragments, locale → TipTap JSON. Only used while the block editor shows. */
  collabContent?: Record<string, unknown> | null
}

export interface PageSubmitData {
  title: string
  slug: string
  pageType: string
  status: string
  visibility: string
  publishedAt: unknown
  showInNavigation: boolean
  layout: string
  parentId: string | null
  seoTitle: string
  seoDescription: string
  ogImage: string
  robots: string
  content: unknown
  translations: Translations
  config: Record<string, unknown> | null
}

export type PageSubmitResult =
  | { ok: true; data: PageSubmitData }
  | { ok: false; reason: 'title-required' }

/** Regular pages carry no type-specific config, but these page-level flags live there and must survive. */
const PAGE_LEVEL_CONFIG_KEYS = ['hideNav', 'hideAuthControls', 'requiredScope'] as const

function regularPageConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!config) return null
  const kept = Object.fromEntries(
    PAGE_LEVEL_CONFIG_KEYS
      .filter(key => config[key] !== undefined && config[key] !== false)
      .map(key => [key, config[key]]),
  )
  return Object.keys(kept).length ? kept : null
}

/** Block editor emits TipTap JSON objects — the text column wants a string. */
function asStoredContent(content: unknown): unknown {
  return content && typeof content === 'object' ? JSON.stringify(content) : content
}

type Deps = { slugify: (text: string) => string }

/** Copy locale by locale: the caller's state must not change (the form is still showing it). */
function cloneTranslations(state: Record<string, any>): Translations {
  const out: Translations = {}
  for (const [loc, data] of Object.entries((state.translations ?? {}) as Translations)) out[loc] = { ...data }
  return out
}

/** Live collab fragments override the form's content for their locale. */
function applyCollabContent(translations: Translations, collabContent: Record<string, unknown>): void {
  for (const [loc, json] of Object.entries(collabContent)) {
    translations[loc] = { ...(translations[loc] ?? {}), content: JSON.stringify(json) }
  }
}

function hasAnyTitle(translations: Translations): boolean {
  return Object.values(translations).some(t => !!t?.title && t.title.trim().length > 0)
}

/** A titled locale without a slug gets one; object content becomes the stored string. */
function normalizeTranslation(entry: Translation, deps: Deps): Translation {
  let out = entry
  if (out.title && (!out.slug || out.slug.trim() === '')) out = { ...out, slug: deps.slugify(out.title) }
  if (out.content && typeof out.content === 'object') out = { ...out, content: asStoredContent(out.content) }
  return out
}

export function buildPageSubmitData(input: PageSubmitInput, deps: Deps): PageSubmitResult {
  const { state, showBlockEditor, isRegularPage, collabContent } = input

  const translations = cloneTranslations(state)
  if (collabContent && showBlockEditor) applyCollabContent(translations, collabContent)
  if (!hasAnyTitle(translations)) return { ok: false, reason: 'title-required' }
  for (const loc of Object.keys(translations)) translations[loc] = normalizeTranslation(translations[loc]!, deps)

  // The database has flat title/slug/content columns — the primary locale fills them.
  const primary: Translation = translations[Object.keys(translations)[0] ?? 'en'] ?? {}
  const rawContent = showBlockEditor ? (primary.content || state.content) : state.content

  return {
    ok: true,
    data: {
      title: primary.title || state.title,
      slug: primary.slug || state.slug,
      pageType: state.pageType,
      status: state.status,
      visibility: state.visibility,
      publishedAt: state.publishedAt,
      showInNavigation: state.showInNavigation,
      layout: state.layout,
      parentId: state.parentId,
      seoTitle: primary.seoTitle || '',
      seoDescription: primary.seoDescription || '',
      ogImage: state.ogImage,
      robots: state.robots,
      content: asStoredContent(rawContent),
      translations,
      config: isRegularPage ? regularPageConfig(state.config) : state.config,
    },
  }
}
