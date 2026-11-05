import { describe, it, expect } from 'vitest'
import { validateField } from '../../../lib/utils/load-fields.ts'
import { jsString, htmlAttr, jsLiteral } from '../../../lib/utils/helpers.ts'

const types = new Set(['string', 'number', 'text'])
const check = (name: unknown, def: Record<string, any> = { type: 'string' }) => validateField(name, def, types)

describe('validateField (#2732)', () => {
  it('accepts a plain field', () => {
    expect(() => check('firstName', { type: 'string', meta: { required: true, area: 'main' } })).not.toThrow()
  })

  it.each(['first-name', '1abc', 'a b', '', 'x.y'])('rejects invalid name %j', (name) => {
    expect(() => check(name)).toThrow(/Invalid field name/)
  })

  it.each(['id', 'owner', 'path', 'order', 'depth', 'parentId', 'teamId', 'createdAt', 'translations'])('rejects reserved name %s', (name) => {
    expect(() => check(name)).toThrow(/collides with a system field/)
  })

  it('rejects unknown types, naming the field', () => {
    expect(() => check('status', { type: 'select' })).toThrow(/Field "status" has unknown type "select"/)
  })

  it('rejects unknown meta keys, naming the field and key', () => {
    expect(() => check('title', { type: 'string', meta: { requird: true } })).toThrow(/Field "title" has unknown meta key "requird"/)
  })
})

describe('escapers (#2732)', () => {
  it('jsString escapes quotes, backslashes and newlines', () => {
    expect(jsString("O'Brien")).toBe("O\\'Brien")
    expect(jsString('a\\b')).toBe('a\\\\b')
    expect(jsString('a\nb')).toBe('a\\nb')
  })

  it('htmlAttr escapes attribute-breaking characters', () => {
    expect(htmlAttr('say "hi" <b> & co')).toBe('say &quot;hi&quot; &lt;b&gt; &amp; co')
  })

  it('jsLiteral keeps number/boolean types and quotes strings', () => {
    expect(jsLiteral(1)).toBe('1')
    expect(jsLiteral(true)).toBe('true')
    expect(jsLiteral("O'Brien")).toBe("'O\\'Brien'")
  })
})
