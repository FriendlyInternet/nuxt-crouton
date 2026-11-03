import { it, expect } from 'vitest'
import { buildUpsert } from '../shared/seed/sql'

// #2762: the seeded page upsert REPLACES `translations` wholesale, so a re-seed
// cannot be relied on to add `fr` to existing pages — velo backfills it instead.
it('default upsert overwrites the translations column on conflict', () => {
  const sql = buildUpsert('pages_pages', { id: 'seed:page:t:welcome' }, { translations: { nl: { title: 'Welkom' } } }, { immutable: ['createdAt'] })
  expect(sql).toContain('"translations" = excluded."translations"')
})
