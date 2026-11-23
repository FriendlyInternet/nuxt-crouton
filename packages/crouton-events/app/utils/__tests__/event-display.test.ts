import { describe, it, expect } from 'vitest'
import {
  pickRecordTitle,
  eventItemTitle,
  eventCollectionLabel,
  formatRelativeTime,
  buildEventQuery
} from '../event-display'

describe('event-display helpers (#4036)', () => {
  // covers: T1
  it('pickRecordTitle: string, translations object, display.title override, empty, 120-char cap', () => {
    expect(pickRecordTitle({ title: '  Accueil  ' })).toBe('Accueil')
    expect(pickRecordTitle({ name: 'Gazelle' })).toBe('Gazelle')
    expect(pickRecordTitle({ label: 'Lieu A' })).toBe('Lieu A')
    expect(pickRecordTitle({ title: { fr: 'Accueil', en: 'Home' } })).toBe('Accueil')
    expect(pickRecordTitle({ title: 'Generic', headline: 'Custom' }, 'headline')).toBe('Custom')
    expect(pickRecordTitle({ title: '', name: '   ' })).toBeUndefined()
    expect(pickRecordTitle({ id: 'x' })).toBeUndefined()
    expect(pickRecordTitle(null)).toBeUndefined()
    expect(pickRecordTitle({ title: 'a'.repeat(300) })).toHaveLength(120)
  })

  // covers: T1
  it('eventItemTitle: metadata wins; falls back to title in create changes and old value on delete', () => {
    expect(eventItemTitle({
      metadata: { itemTitle: 'Saved' },
      changes: [{ fieldName: 'title', oldValue: null, newValue: JSON.stringify('From changes') }]
    })).toBe('Saved')
    expect(eventItemTitle({
      changes: [{ fieldName: 'title', oldValue: null, newValue: JSON.stringify('Accueil') }]
    })).toBe('Accueil')
    expect(eventItemTitle({
      changes: [{ fieldName: 'name', oldValue: JSON.stringify('Ancienne page'), newValue: null }]
    })).toBe('Ancienne page')
    expect(eventItemTitle({
      changes: [{ fieldName: 'title', oldValue: null, newValue: JSON.stringify({ fr: 'Bonjour' }) }]
    })).toBe('Bonjour')
    expect(eventItemTitle({ changes: [{ fieldName: 'price', oldValue: '1', newValue: '2' }] })).toBe('')
    expect(eventItemTitle({ changes: [] })).toBe('')
  })

  // covers: T1
  it('eventCollectionLabel: translated adminNav key, missing key → raw label, unknown → words', () => {
    const collections = {
      pagesPages: { adminNav: { label: 'pages.collections.pages.title' } },
      bookingsLocations: { displayName: 'Lieux' }
    }
    const t = (key: string) => (key === 'pages.collections.pages.title' ? 'Pages' : key)
    expect(eventCollectionLabel('pagesPages', collections, t)).toBe('Pages')
    expect(eventCollectionLabel('bookingsLocations', collections, t)).toBe('Lieux')
    // vue-i18n can also bracket a missing key
    expect(eventCollectionLabel('pagesPages', collections, k => `[${k}]`)).toBe('pages.collections.pages.title')
    expect(eventCollectionLabel('veloBikes', collections, t)).toBe('Velo bikes')
    expect(eventCollectionLabel('veloBikes', undefined, t)).toBe('Velo bikes')
  })

  // covers: T1
  it('formatRelativeTime: French relative wording', () => {
    const now = new Date('2026-11-17T12:00:00Z')
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000), now, 'fr')).toBe('il y a 5 minutes')
    expect(formatRelativeTime(new Date(now.getTime() - 24 * 3600_000), now, 'fr')).toBe('hier')
    expect(formatRelativeTime(now.toISOString(), now, 'en')).toBe('now')
  })

  // covers: T1
  it('buildEventQuery: drops empty filters, dates → ISO, page defaults', () => {
    const from = new Date('2026-11-01T00:00:00Z')
    const to = new Date('2026-11-17T00:00:00Z')
    expect(buildEventQuery({
      teamId: 'team1',
      filters: { collectionName: 'pagesPages', operation: '', userId: undefined, dateFrom: from, dateTo: to },
      pagination: {}
    })).toEqual({
      teamId: 'team1',
      collectionName: 'pagesPages',
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      page: 1,
      pageSize: 50
    })
    expect(buildEventQuery({ filters: {} })).toEqual({})
    expect(buildEventQuery({ pagination: { page: 3, pageSize: 10 }, enrichUserData: true }))
      .toEqual({ page: 3, pageSize: 10, enrichUserData: true })
  })
})
