import { describe, it, expect } from 'vitest'
import { withManifest } from '../../helpers/manifest-fields.ts'
import { generateSeedFixture } from '../../../lib/generators/collection-seed-fixture.ts'

const blogFields = withManifest([
  { name: 'title', type: 'string', meta: { required: true } },
  { name: 'slug', type: 'string', meta: { required: true } },
  { name: 'body', type: 'text', meta: {} },
  { name: 'author', type: 'string', meta: {} },
  { name: 'publishedAt', type: 'date', meta: {} },
  { name: 'status', type: 'string', meta: { options: ['draft', 'published'] } },
  { name: 'tags', type: 'array', meta: {} },
  // injected system + FK fields that must be excluded
  { name: 'id', type: 'string', meta: {} },
  { name: 'teamId', type: 'string', meta: {} },
  { name: 'createdAt', type: 'date', meta: {} },
  { name: 'categoryId', type: 'string', meta: {}, refTarget: 'categories' },
])

describe('generateSeedFixture (#298)', () => {
  const fixture = generateSeedFixture({ layer: 'blog', plural: 'posts', fields: blogFields })!

  it('derives the snake_case table name and picks slug as the key', () => {
    expect(fixture.table).toBe('blog_posts')
    expect(fixture.key).toBe('slug')
    expect(fixture.rows).toHaveLength(3)
  })

  it('excludes auto/system and FK fields from rows', () => {
    const cols = Object.keys(fixture.rows[0])
    expect(cols).toContain('title')
    expect(cols).toContain('status')
    expect(cols).not.toContain('id')
    expect(cols).not.toContain('teamId')
    expect(cols).not.toContain('createdAt')
    expect(cols).not.toContain('categoryId') // FK ref skipped
  })

  it('produces sensible per-type values', () => {
    const r0 = fixture.rows[0] as any
    expect(r0.slug).toBe('sample-1')
    expect(typeof r0.publishedAt).toBe('number') // unix seconds, not an ISO string
    expect(Array.isArray(r0.tags)).toBe(true)
    // select cycles, biased so the newest row leads with the last option
    expect(r0.status).toBe('published')
    expect((fixture.rows[1] as any).status).toBe('draft')
  })

  it('stages dates newest-first', () => {
    const t0 = (fixture.rows[0] as any).publishedAt
    const t1 = (fixture.rows[1] as any).publishedAt
    expect(t0).toBeGreaterThan(t1) // row 0 newer than row 1
  })

  it('returns null for hierarchy collections', () => {
    expect(generateSeedFixture({ layer: 'blog', plural: 'posts', fields: blogFields, hierarchy: { enabled: true } })).toBeNull()
  })
})
