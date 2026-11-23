import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkCroutonSchema } from '../server/utils/check-crouton-schema'
import { EXAMPLE_SCHEMAS } from '../server/utils/example-schemas'

const docsRoot = fileURLToPath(new URL('..', import.meta.url))

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return markdownFiles(p)
    return p.endsWith('.md') ? [p] : []
  })
}

function parseJson(src: string): unknown {
  try {
    return JSON.parse(src)
  } catch {
    return undefined
  }
}

/** A ```json block is a field schema when it is an object whose every value has a string `type`. */
function isFieldSchema(obj: unknown): obj is Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const values = Object.values(obj)
  return values.length > 0 && values.every(v => v && typeof v === 'object' && typeof v.type === 'string')
}

function schemaBlocks(file: string): Array<{ where: string, schema: Record<string, any> }> {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/```json[^\n]*\n([\s\S]*?)```/g)]
    .map(m => ({ m, obj: parseJson(m[1]!) }))
    .filter((b): b is { m: RegExpExecArray, obj: Record<string, any> } => isFieldSchema(b.obj))
    .map(({ m, obj }) => ({ where: `${relative(docsRoot, file)}:${text.slice(0, m.index).split('\n').length}`, schema: obj }))
}

// The bike-rental rentals schema from #3163 — the connector said "valid" to all three mistakes.
const bikeRental = {
  bikeId: { type: 'string', refTarget: 'bikes', meta: { required: true, readonly: true } },
  status: { type: 'string', meta: { required: true, options: ['reserved', 'active', 'returned'] } },
  extras: { type: 'repeater', children: { name: { type: 'string' }, price: { type: 'decimal' } } },
  startDate: { type: 'date', meta: { required: true } }
}

const bikeRentalFixed = {
  bikeId: { type: 'string', refTarget: 'bikes', meta: { required: true, readOnly: true } },
  status: { type: 'string', meta: { required: true, displayAs: 'optionsSelect', options: ['reserved', 'active', 'returned'] } },
  extras: { type: 'repeater', meta: { properties: { name: { type: 'string' }, price: { type: 'decimal' } } } },
  startDate: { type: 'date', meta: { required: true } }
}

describe('checkCroutonSchema (#3165)', () => {
  it('bike-rental schema fails with exactly 3 errors, each with its fix', () => {
    const { errors } = checkCroutonSchema(bikeRental)
    expect(errors).toHaveLength(3)
    expect(errors.some(e => /readonly.*did you mean "readOnly"/.test(e))).toBe(true)
    expect(errors.some(e => /options.*displayAs: "optionsSelect"/.test(e))).toBe(true)
    expect(errors.some(e => /children.*meta\.properties/.test(e))).toBe(true)
  })

  it('the corrected bike-rental schema passes', () => {
    expect(checkCroutonSchema(bikeRentalFixed)).toEqual({ errors: [], warnings: [] })
  })

  it('readOnly on a non-reference field is an error', () => {
    const { errors } = checkCroutonSchema({ total: { type: 'decimal', meta: { readOnly: true } } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/only works on reference fields/)
  })

  it('optionsCollection without displayAs is an error', () => {
    const { errors } = checkCroutonSchema({ kind: { type: 'string', meta: { optionsCollection: 'settings', optionsField: 'kinds' } } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/optionsCollection.*displayAs: "optionsSelect"/)
  })

  it('a meta key at field level says "move it under meta"', () => {
    const { errors } = checkCroutonSchema({ title: { type: 'string', required: true } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/unknown key "required".*move it under meta/)
  })

  it('an unknown meta key with no close match lists the allowed keys', () => {
    const { errors } = checkCroutonSchema({ title: { type: 'string', meta: { showInTable: true } } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/unknown meta key "showInTable" — allowed: required/)
  })

  it('a repeater with no item fields warns about meta.properties', () => {
    expect(checkCroutonSchema({ items: { type: 'repeater' } }).warnings[0]).toMatch(/meta\.properties/)
  })

  it('every get_example_schema example passes', () => {
    for (const [name, { schema }] of Object.entries(EXAMPLE_SCHEMAS)) {
      expect(checkCroutonSchema(schema), name).toEqual({ errors: [], warnings: [] })
    }
  })

  it('every schema example in docs/content passes', () => {
    const blocks = markdownFiles(join(docsRoot, 'content')).flatMap(schemaBlocks)
    expect(blocks.length).toBeGreaterThan(0)
    const failures = blocks.flatMap(({ where, schema }) => checkCroutonSchema(schema).errors.map(e => `${where} — ${e}`))
    expect(failures).toEqual([])
  })
})

describe('validate_schema tool handler (#3165)', () => {
  let handler: (args: { schema: string }) => Promise<{ content: Array<{ text: string }> }>

  beforeAll(async () => {
    // Nitro's auto-imported global; the tool module only passes its definition through it.
    ;(globalThis as any).defineMcpTool = (def: unknown) => def
    handler = (await import('../server/mcp/tools/validate-schema')).default.handler
  })

  it('reports the bike-rental schema\'s 3 errors with their fixes', async () => {
    const { content } = await handler({ schema: JSON.stringify(bikeRental) })
    expect(content[0]!.text).toMatch(/Validation Errors\*\* \(3\)/)
    expect(content[0]!.text).toMatch(/did you mean "readOnly"/)
    expect(content[0]!.text).toMatch(/displayAs: "optionsSelect"/)
    expect(content[0]!.text).toMatch(/meta\.properties/)
  })

  it('says valid for the corrected schema', async () => {
    const { content } = await handler({ schema: JSON.stringify(bikeRentalFixed) })
    expect(content[0]!.text).toMatch(/Schema is valid!/)
  })
})
