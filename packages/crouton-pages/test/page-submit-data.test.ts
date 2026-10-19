/**
 * #2322 — slice 1 of the editor split (#1640): the save payload is a pure function.
 *
 * This is the behaviour `handleSubmit` had inline for a year, pinned before the code moves:
 * what the editor sends to the API for every kind of page, and what it must NEVER send
 * (identity, ownership, hierarchy and audit fields — the #1403 allowlist). Later slices
 * refactor around this; if one of these cases changes, something in someone's saved page
 * changed.
 */
import { describe, it, expect } from 'vitest'
import { buildPageSubmitData } from '../app/utils/page-submit-data'
import { slugify } from '../../crouton-core/shared/utils/slugify'

const deps = { slugify }

const base = () => ({
  id: 'p1',
  teamId: 'team-1',
  owner: 'u1',
  createdBy: 'u1',
  updatedBy: 'u1',
  path: '/about',
  depth: 0,
  ownerUser: { id: 'u1', email: 'staff@example.com' },
  title: 'stale root title',
  slug: 'stale-root-slug',
  pageType: 'pages:regular',
  status: 'draft',
  visibility: 'public',
  publishedAt: null,
  showInNavigation: true,
  layout: 'default',
  parentId: null,
  ogImage: '',
  robots: 'index',
  content: '',
  config: {},
  translations: {
    en: { title: 'About us', slug: '', seoTitle: 'About', seoDescription: '' },
    nl: { title: 'Over ons', slug: 'over-ons' },
  },
})

const build = (state: Record<string, any>, extra: Partial<Parameters<typeof buildPageSubmitData>[0]> = {}) =>
  buildPageSubmitData({ state, showBlockEditor: false, isRegularPage: true, ...extra }, deps)

describe('buildPageSubmitData', () => {
  it('flattens the primary locale to the root fields and auto-slugs a missing slug', () => {
    const r = build(base())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.title).toBe('About us')
    expect(r.data.slug).toBe('about-us')
    expect(r.data.seoTitle).toBe('About')
    expect(r.data.translations.en.slug).toBe('about-us')
    expect(r.data.translations.nl.slug).toBe('over-ons') // existing slug respected
  })

  it('never sends identity, ownership, hierarchy or audit fields (#1403 allowlist)', () => {
    const r = build(base())
    if (!r.ok) throw new Error('expected ok')
    for (const k of ['id', 'teamId', 'owner', 'createdBy', 'updatedBy', 'path', 'depth', 'ownerUser']) {
      expect(r.data, k).not.toHaveProperty(k)
    }
    expect(Object.keys(r.data).sort()).toEqual([
      'config', 'content', 'layout', 'ogImage', 'pageType', 'parentId', 'publishedAt', 'robots',
      'seoDescription', 'seoTitle', 'showInNavigation', 'slug', 'status', 'title', 'translations', 'visibility',
    ])
  })

  it('refuses a page with no title in any locale, and says why', () => {
    const s = base()
    s.translations = { en: { title: '   ', slug: '' }, nl: { title: '', slug: '' } } as any
    expect(build(s)).toEqual({ ok: false, reason: 'title-required' })
  })

  it('stringifies block content that arrives as a TipTap object, per locale and at the root', () => {
    const s = base()
    s.pageType = 'pages:block-content'
    s.translations.en = { ...s.translations.en, content: { type: 'doc', content: [] } } as any
    s.content = { type: 'doc', content: [{ type: 'paragraph' }] } as any
    const r = build(s, { showBlockEditor: true, isRegularPage: false })
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.translations.en.content).toBe('{"type":"doc","content":[]}')
    // block editor: the primary locale's content wins over the root column
    expect(r.data.content).toBe('{"type":"doc","content":[]}')
  })

  it('takes collab fragments over the form state when the block editor is live', () => {
    const s = base()
    const r = build(s, {
      showBlockEditor: true,
      isRegularPage: false,
      collabContent: { en: { type: 'doc', content: [{ type: 'heading' }] }, fr: { type: 'doc', content: [] } },
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.translations.en.content).toBe('{"type":"doc","content":[{"type":"heading"}]}')
    expect(r.data.translations.fr).toEqual({ content: '{"type":"doc","content":[]}' }) // a locale the form had no entry for
    expect(r.data.translations.en.title).toBe('About us') // other fields untouched
  })

  it('ignores collab fragments when the block editor is not showing', () => {
    const r = build(base(), { collabContent: { en: { type: 'doc' } } })
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.translations.en).not.toHaveProperty('content')
  })

  it('keeps only page-level flags in a regular page config, and nulls an empty one', () => {
    const s = base()
    s.config = { hideNav: true, hideAuthControls: false, requiredScope: 'members', collection: 'leak' }
    const r = build(s)
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.config).toEqual({ hideNav: true, requiredScope: 'members' })

    const empty = base()
    empty.config = { hideNav: false }
    const r2 = build(empty)
    if (!r2.ok) throw new Error('expected ok')
    expect(r2.data.config).toBeNull()
  })

  it('passes a non-regular page config through untouched', () => {
    const s = base()
    s.pageType = 'pages:collection-binder'
    s.config = { collection: 'salesProducts', sortField: 'name', hideNav: true }
    const r = build(s, { isRegularPage: false })
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.config).toEqual({ collection: 'salesProducts', sortField: 'name', hideNav: true })
  })

  it('falls back to the root title/slug when the primary locale has none, and does not mutate the input', () => {
    const s = base()
    s.translations = { en: { slug: 'kept', seoTitle: '' , title: 'X' } } as any
    const snapshot = JSON.stringify(s)
    const r = build(s)
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.slug).toBe('kept')
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})
