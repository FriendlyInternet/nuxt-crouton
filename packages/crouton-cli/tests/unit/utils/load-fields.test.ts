import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFields } from '../../../lib/utils/load-fields.ts'

// Mirrors the shape getTypeMapping() produces: alias keys carry the canonical
// type via `canonical`, so loadFields can normalize them (#285).
const typeMapping = {
  string: { db: '', drizzle: '', zod: 'z.string()', default: "''", tsType: 'string', canonical: 'string', component: 'UInput' },
  number: { db: '', drizzle: '', zod: 'z.number()', default: '0', tsType: 'number', canonical: 'number', component: 'UInputNumber' },
  date: { db: '', drizzle: '', zod: 'z.date()', default: 'null', tsType: 'Date | null', canonical: 'date', component: 'CroutonCalendar' },
  // aliases — same def as their canonical, with canonical pointing back
  integer: { db: '', drizzle: '', zod: 'z.number()', default: '0', tsType: 'number', canonical: 'number', component: 'UInputNumber' },
  datetime: { db: '', drizzle: '', zod: 'z.date()', default: 'null', tsType: 'Date | null', canonical: 'date', component: 'CroutonCalendar' },
}

async function loadFromSchema(schema: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'crouton-fields-'))
  const p = join(dir, 'schema.json')
  await writeFile(p, JSON.stringify(schema))
  try {
    const fields = await loadFields(p, typeMapping as any)
    return Object.fromEntries(fields.map(f => [f.name, f]))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('loadFields alias resolution (#285)', () => {
  it('resolves the `datetime` alias to the canonical `date` type', async () => {
    const byName = await loadFromSchema({ publishedAt: { type: 'datetime' } })
    expect(byName.publishedAt.type).toBe('date')
    expect(byName.publishedAt.zod).toBe('z.date()')
    expect(byName.publishedAt.tsType).toBe('Date | null')
  })

  it('resolves the `integer` alias to the canonical `number` type', async () => {
    const byName = await loadFromSchema({ count: { type: 'integer' } })
    expect(byName.count.type).toBe('number')
    expect(byName.count.zod).toBe('z.number()')
  })

  it('leaves canonical types and unknown types untouched', async () => {
    const byName = await loadFromSchema({ title: { type: 'string' }, when: { type: 'date' }, weird: { type: 'nope' } })
    expect(byName.title.type).toBe('string')
    expect(byName.when.type).toBe('date')
    expect(byName.weird.type).toBe('string') // unknown → string fallback
  })
})

describe('loadFields attaches the manifest-declared form component (#2286)', () => {
  // The manifest's `component` column is the single source for "which form
  // control renders this type". Before #2286 generators kept their own
  // type→component switch and never read it, so a manifest change was silent.
  it('copies `component` from the type mapping onto the field', async () => {
    const byName = await loadFromSchema({ title: { type: 'string' }, when: { type: 'date' } })
    expect(byName.title.component).toBe('UInput')
    expect(byName.when.component).toBe('CroutonCalendar')
  })

  it('resolves an alias to its canonical type\'s component', async () => {
    const byName = await loadFromSchema({ at: { type: 'datetime' }, n: { type: 'integer' } })
    expect(byName.at.component).toBe('CroutonCalendar')
    expect(byName.n.component).toBe('UInputNumber')
  })

  it('gives an unknown type the string fallback\'s component (unknown → string, as before)', async () => {
    const byName = await loadFromSchema({ weird: { type: 'nope' } })
    expect(byName.weird.type).toBe('string')
    expect(byName.weird.component).toBe('UInput')
  })
})
