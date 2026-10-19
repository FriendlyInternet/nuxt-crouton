/**
 * The page record behind the editor: load, state, save, delete (#2323, slice 2 of #1640).
 *
 * The editor component used to own all of this inline (~250 lines). It now owns the screen;
 * this owns the data. Every tab binds to `state`; the component decides when to `load()`
 * (its `pageId` watcher) and what to do with the result (collab seeding, notifications).
 *
 * Dependencies are injected so the composable runs in a unit test without Nuxt;
 * `usePageRecordDeps()` builds the real ones from the app's auto-imports.
 * Contract: `test/use-page-record.test.ts`.
 */
import { computed, ref } from 'vue'
import { buildPageSubmitData, type PageSubmitData } from '../utils/page-submit-data'

export interface PageRecordDeps {
  /** The page row for an id (list/ids endpoint unwrapped), or null when it does not exist. */
  fetchPage: (id: string) => Promise<Record<string, any> | null>
  create: (data: PageSubmitData) => Promise<any>
  update: (id: string, data: PageSubmitData) => Promise<any>
  deleteItems: (ids: string[]) => Promise<unknown>
  slugify: (text: string) => string
  /** Display name stamped on `updatedByUser` after a save (no re-fetch). */
  currentUserName: () => string
  /** Translated fallback for `loadError` when the failure carries no message. */
  loadFailedMessage?: () => string
}

export interface PageRecordOptions {
  pageId: () => string | null | undefined
  defaultParentId?: () => string | null | undefined
  /** Locale a flat API row (no `translations`) is filed under. */
  fallbackLocale: () => string
}

export interface PageSaveInput {
  showBlockEditor: boolean
  isRegularPage: boolean
  collabContent?: Record<string, unknown> | null
}

export type PageSaveResult =
  | { ok: true; page: Record<string, any> }
  | { ok: false; reason: 'title-required' | 'request-failed' }

export const PAGE_DEFAULTS = {
  pageType: 'pages:regular',
  config: {},
  status: 'draft',
  visibility: 'public',
  showInNavigation: true,
  layout: 'default',
  parentId: null,
  order: 0,
  translations: {},
  ogImage: '',
  robots: 'index',
} as const

type PageState = Record<string, any> & { id?: string | null }

/** A flat API row (no `translations` column) is filed under one locale. */
function translationsFromFlatRow(row: Record<string, any>, locale: string): Record<string, Record<string, string>> {
  const pick = (key: string) => row[key] || ''
  return {
    [locale]: {
      title: pick('title'),
      slug: pick('slug'),
      seoTitle: pick('seoTitle'),
      seoDescription: pick('seoDescription'),
      content: pick('content'),
    },
  }
}

function hasTranslations(row: Record<string, any>): boolean {
  return !!row.translations && Object.keys(row.translations).length > 0
}

export function usePageRecord(options: PageRecordOptions, deps: PageRecordDeps) {
  const state = ref<PageState>({ ...PAGE_DEFAULTS })
  const isLoading = ref(false)
  const isSaving = ref(false)
  const loadError = ref<string | null>(null)
  const action = computed<'create' | 'update'>(() => (options.pageId() ? 'update' : 'create'))

  /** Create mode: back to the defaults, with the pre-filled parent if any. */
  function reset(): void {
    state.value = { ...PAGE_DEFAULTS, parentId: options.defaultParentId?.() ?? null }
    loadError.value = null
  }

  /** Update mode: fetch the page into `state`. Returns the raw row, or null on failure (see `loadError`). */
  async function load(id: string): Promise<Record<string, any> | null> {
    isLoading.value = true
    loadError.value = null
    try {
      const pageData = await deps.fetchPage(id)
      if (!pageData) throw new Error('Page not found')
      state.value = { ...PAGE_DEFAULTS, ...pageData }
      if (!hasTranslations(pageData)) {
        state.value.translations = translationsFromFlatRow(pageData, options.fallbackLocale() || 'en')
      }
      return pageData
    } catch (error: any) {
      loadError.value = error?.message || deps.loadFailedMessage?.() || 'Failed to load page'
      console.error('Failed to load page:', error)
      return null
    } finally {
      isLoading.value = false
    }
  }

  /** Build the payload (pure, tested) and send it; create or update by mode. */
  async function save(input: PageSaveInput): Promise<PageSaveResult> {
    const built = buildPageSubmitData({ state: state.value, ...input }, { slugify: deps.slugify })
    if (!built.ok) return { ok: false, reason: built.reason }

    isSaving.value = true
    try {
      let saved: any
      if (action.value === 'create') {
        saved = await deps.create(built.data)
      } else if (state.value.id) {
        saved = await deps.update(state.value.id, built.data)
        // Reflect the save locally without a re-fetch.
        state.value.updatedAt = Date.now()
        state.value.updatedByUser = { name: deps.currentUserName() }
      }
      return { ok: true, page: saved || built.data }
    } catch (error) {
      console.error('Form submission failed:', error)
      return { ok: false, reason: 'request-failed' }
    } finally {
      isSaving.value = false
    }
  }

  /** Delete the loaded page; returns its id, or null when there is nothing to delete. */
  async function remove(): Promise<string | null> {
    const id = state.value.id
    if (!id) return null
    await deps.deleteItems([id])
    return id
  }

  return { state, action, isLoading, isSaving, loadError, reset, load, save, remove }
}

/** The list/ids endpoint answers `{ items }`, a bare array, or one row — take the first row. */
function firstRow(response: any): Record<string, any> | null {
  const rows = response?.items ?? response
  return (Array.isArray(rows) ? rows[0] : rows) ?? null
}

/**
 * The real dependencies, from the app's auto-imports. Called from the editor component
 * (a Nuxt context); never from a unit test.
 */
export function usePageRecordDeps(currentUserName: () => string): PageRecordDeps {
  const { t } = useT()
  const { create, update, deleteItems } = useCollectionMutation('pagesPages')
  const apiPath = useCollections().getConfig('pagesPages')?.apiPath || 'pages-pages'
  const { getTeamId } = useTeamContext()
  return {
    async fetchPage(id) {
      const teamId = getTeamId()
      if (!teamId) throw new Error('Team context required')
      return firstRow(await $fetch<any>(`/api/teams/${teamId}/${apiPath}`, { method: 'GET', query: { ids: id }, credentials: 'include' }))
    },
    create,
    update,
    deleteItems,
    slugify,
    currentUserName,
    loadFailedMessage: () => t('pages.errors.loadFailed'),
  }
}
