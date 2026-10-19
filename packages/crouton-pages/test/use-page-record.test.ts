/**
 * #2323 — slice 2 of the editor split (#1640): loading, state, saving and deleting a page
 * live in `usePageRecord`, not in the editor component.
 *
 * Pinned before the move: create vs update mode, what load() does with flat API rows, the
 * error paths, what save() sends and returns, and that remove() only acts with an id.
 * Dependencies (fetch, mutations, slugify, current user) are injected, so this runs without
 * Nuxt; `usePageRecordDeps()` assembles the real ones inside the app.
 */
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { usePageRecord, PAGE_DEFAULTS } from '../app/composables/usePageRecord'
import { slugify } from '../../crouton-core/shared/utils/slugify'

function makeDeps(over: Partial<Parameters<typeof usePageRecord>[1]> = {}) {
  return {
    fetchPage: vi.fn(async (id: string) => ({ id, title: 'Loaded', slug: 'loaded', pageType: 'pages:regular', status: 'published', config: null })),
    create: vi.fn(async (data: any) => ({ id: 'new-1', ...data })),
    update: vi.fn(async (id: string, data: any) => ({ id, ...data })),
    deleteItems: vi.fn(async () => true),
    slugify,
    currentUserName: () => 'Ada',
    ...over,
  }
}

function make(pageId: string | null = null, deps = makeDeps(), defaultParentId: string | null = null) {
  const id = ref(pageId)
  const record = usePageRecord({ pageId: () => id.value, defaultParentId: () => defaultParentId, fallbackLocale: () => 'en' }, deps)
  return { record, id, deps }
}

describe('usePageRecord — mode and defaults', () => {
  it('starts in create mode with the page defaults', () => {
    const { record } = make()
    expect(record.action.value).toBe('create')
    expect(record.state.value).toEqual({ ...PAGE_DEFAULTS })
    expect(record.isLoading.value).toBe(false)
    expect(record.loadError.value).toBeNull()
  })

  it('is in update mode when a pageId is given, and follows it', () => {
    const { record, id } = make('p1')
    expect(record.action.value).toBe('update')
    id.value = null
    expect(record.action.value).toBe('create')
  })

  it('reset() returns to the defaults with the pre-filled parent', () => {
    const { record } = make(null, makeDeps(), 'parent-9')
    record.state.value.title = 'typed'
    record.reset()
    expect(record.state.value).toEqual({ ...PAGE_DEFAULTS, parentId: 'parent-9' })
  })
})

describe('usePageRecord — load()', () => {
  it('merges the fetched page over the defaults and rebuilds translations from flat columns', async () => {
    const { record, deps } = make('p1')
    const page = await record.load('p1')
    expect(deps.fetchPage).toHaveBeenCalledWith('p1')
    expect(page?.id).toBe('p1')
    expect(record.state.value.status).toBe('published')
    expect(record.state.value.showInNavigation).toBe(true) // default kept for a column the row lacks
    expect(record.state.value.translations).toEqual({
      en: { title: 'Loaded', slug: 'loaded', seoTitle: '', seoDescription: '', content: '' },
    })
    expect(record.isLoading.value).toBe(false)
    expect(record.loadError.value).toBeNull()
  })

  it('keeps translations the API already returns', async () => {
    const deps = makeDeps({ fetchPage: vi.fn(async () => ({ id: 'p2', translations: { nl: { title: 'Hoi' } } })) })
    const { record } = make('p2', deps)
    await record.load('p2')
    expect(record.state.value.translations).toEqual({ nl: { title: 'Hoi' } })
  })

  it('reports isLoading while the fetch is in flight', async () => {
    let release!: (v: any) => void
    const deps = makeDeps({ fetchPage: vi.fn(() => new Promise(r => { release = r })) })
    const { record } = make('p1', deps)
    const p = record.load('p1')
    expect(record.isLoading.value).toBe(true)
    release({ id: 'p1' })
    await p
    expect(record.isLoading.value).toBe(false)
  })

  it('sets loadError and returns null when the page is missing or the request fails', async () => {
    const missing = make('nope', makeDeps({ fetchPage: vi.fn(async () => null) }))
    expect(await missing.record.load('nope')).toBeNull()
    expect(missing.record.loadError.value).toBe('Page not found')

    const failing = make('p1', makeDeps({ fetchPage: vi.fn(async () => { throw new Error('boom') }) }))
    expect(await failing.record.load('p1')).toBeNull()
    expect(failing.record.loadError.value).toBe('boom')
    expect(failing.record.isLoading.value).toBe(false)

    const silent = make('p1', makeDeps({ fetchPage: vi.fn(async () => { throw new Error('') }), loadFailedMessage: () => 'Laden mislukt' }))
    await silent.record.load('p1')
    expect(silent.record.loadError.value).toBe('Laden mislukt')
  })
})

describe('usePageRecord — save()', () => {
  const edit = (record: ReturnType<typeof usePageRecord>) => {
    record.state.value.translations = { en: { title: 'Hello world', slug: '' } }
  }

  it('creates when there is no id, sending the built payload, and returns the saved page', async () => {
    const { record, deps } = make()
    edit(record)
    const r = await record.save({ showBlockEditor: false, isRegularPage: true, collabContent: null })
    expect(r).toMatchObject({ ok: true, page: { id: 'new-1', title: 'Hello world', slug: 'hello-world' } })
    expect(deps.create).toHaveBeenCalledTimes(1)
    expect(deps.update).not.toHaveBeenCalled()
    expect(deps.create.mock.calls[0][0]).not.toHaveProperty('id')
  })

  it('updates when there is an id, then refreshes the local audit fields', async () => {
    const { record, deps } = make('p1')
    await record.load('p1')
    edit(record)
    const r = await record.save({ showBlockEditor: false, isRegularPage: true, collabContent: null })
    expect(r.ok).toBe(true)
    expect(deps.update).toHaveBeenCalledWith('p1', expect.objectContaining({ title: 'Hello world' }))
    expect(record.state.value.updatedByUser).toEqual({ name: 'Ada' })
    expect(typeof record.state.value.updatedAt).toBe('number')
  })

  it('refuses without a title and sends nothing', async () => {
    const { record, deps } = make()
    const r = await record.save({ showBlockEditor: false, isRegularPage: true, collabContent: null })
    expect(r).toEqual({ ok: false, reason: 'title-required' })
    expect(deps.create).not.toHaveBeenCalled()
    expect(record.isSaving.value).toBe(false)
  })

  it('reports a failed request and clears isSaving', async () => {
    const { record } = make(null, makeDeps({ create: vi.fn(async () => { throw new Error('500') }) }))
    edit(record)
    const r = await record.save({ showBlockEditor: false, isRegularPage: true, collabContent: null })
    expect(r).toEqual({ ok: false, reason: 'request-failed' })
    expect(record.isSaving.value).toBe(false)
  })
})

describe('usePageRecord — remove()', () => {
  it('deletes the loaded page and returns its id', async () => {
    const { record, deps } = make('p1')
    await record.load('p1')
    expect(await record.remove()).toBe('p1')
    expect(deps.deleteItems).toHaveBeenCalledWith(['p1'])
  })

  it('does nothing without an id', async () => {
    const { record, deps } = make()
    expect(await record.remove()).toBeNull()
    expect(deps.deleteItems).not.toHaveBeenCalled()
  })
})
