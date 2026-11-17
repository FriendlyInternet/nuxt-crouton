import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inboxCardsConfig } from '../layers/inbox/collections/cards/app/composables/useInboxCards'

const schema = JSON.parse(readFileSync(new URL('../schemas/cards.json', import.meta.url), 'utf8'))
const seed = JSON.parse(readFileSync(new URL('../layers/inbox/collections/cards/seed.json', import.meta.url), 'utf8'))
const values = (field: string) => schema[field].meta.options.map((o: { value: string }) => o.value)

describe('cards schema (signed off on #3763)', () => {
  it('has exactly the 16 signed-off fields', () => {
    expect(Object.keys(schema)).toEqual([
      'kind', 'sourceType', 'sourceNumber', 'sourceCommentId', 'title', 'ask', 'recommendation', 'link',
      'payload', 'state', 'answer', 'answerNote', 'answeredVia', 'answerUrl', 'askedAt', 'answeredAt'
    ])
  })

  it('closed lists are dropdowns with exactly the signed-off values', () => {
    for (const f of ['kind', 'sourceType', 'state', 'answeredVia']) {
      expect(schema[f].type).toBe('string')
      expect(schema[f].meta.displayAs).toBe('optionsSelect')
    }
    expect(values('kind')).toEqual(['review', 'edit', 'delivery', 'quiz', 'choice', 'issue'])
    expect(values('sourceType')).toEqual(['issue', 'pr'])
    expect(values('state')).toEqual(['waiting', 'answered', 'stale'])
    expect(values('answeredVia')).toEqual(['inbox', 'github'])
  })

  it('a new card starts as waiting', () => {
    expect(schema.state.meta.default).toBe('waiting')
    expect(inboxCardsConfig.defaultValues.state).toBe('waiting')
  })

  it('ships no sample cards to the live app', () => {
    expect(seed.table).toBe('inbox_cards')
    expect(seed.rows).toEqual([])
  })
})
