/**
 * Talk-to-order parser — behaviour contract (#1429, test-first gate #774).
 *
 * The parser turns one STT utterance (nl) into draft cart lines against the
 * event's real products. The helper always reviews the result — so the
 * contract favors "report as unmatched" over "guess wrong", and unmatched
 * segments are never silently dropped.
 */
import { describe, it, expect } from 'vitest'
import { parseVoiceOrder, classifyVoiceError, type VoiceOrderProduct } from '../app/utils/voice-order'

const p = (id: string, title: string, isActive = true): VoiceOrderProduct =>
  ({ id, title, isActive })

// The seeded Vlaamse Kermis catalog — the acceptance environment on staging.
const KERMIS = [
  p('pils', 'Pils'),
  p('frisdrank', 'Frisdrank'),
  p('koffie', 'Koffie'),
  p('frietjes', 'Frietjes'),
  p('hamburger', 'Hamburger')
]

const linesOf = (utterance: string, products = KERMIS) =>
  parseVoiceOrder(utterance, products).lines.map(l => [l.product.id, l.quantity])

describe('parseVoiceOrder — quantities (nl)', () => {
  it('parses the canonical issue example: "twee pils en een koffie"', () => {
    expect(linesOf('twee pils en een koffie')).toEqual([['pils', 2], ['koffie', 1]])
  })

  it('accepts digit quantities', () => {
    expect(linesOf('2 pils')).toEqual([['pils', 2]])
  })

  it('defaults a bare product mention to quantity 1', () => {
    expect(linesOf('koffie')).toEqual([['koffie', 1]])
  })

  it('understands number words up to twintig and the accented één', () => {
    expect(linesOf('één koffie')).toEqual([['koffie', 1]])
    expect(linesOf('twaalf frietjes')).toEqual([['frietjes', 12]])
    expect(linesOf('twintig pils')).toEqual([['pils', 20]])
  })
})

describe('parseVoiceOrder — segmenting an order', () => {
  it('splits on "en" and commas', () => {
    expect(linesOf('twee pils, drie koffie en een hamburger'))
      .toEqual([['pils', 2], ['koffie', 3], ['hamburger', 1]])
  })

  it('ignores polite filler around the order', () => {
    expect(linesOf('doe maar twee pils alsjeblieft')).toEqual([['pils', 2]])
  })

  it('merges repeated mentions of the same product into one line', () => {
    expect(linesOf('twee pils en drie pils')).toEqual([['pils', 5]])
  })

  it('splits on a new quantity even without "en" between items (STT drops it)', () => {
    // The reported bug: "100 frisdrank 100 koffie" ran together as one segment.
    expect(linesOf('honderd frisdrank honderd koffie')).toEqual([['frisdrank', 100], ['koffie', 100]])
    expect(linesOf('twee pils drie koffie')).toEqual([['pils', 2], ['koffie', 3]])
    expect(linesOf('2 frisdrank 2 koffie')).toEqual([['frisdrank', 2], ['koffie', 2]])
  })

  it('still keeps a multi-word title together (no number inside it)', () => {
    const products = [...KERMIS, p('cola-zero', 'Cola Zero')]
    expect(linesOf('twee cola zero drie pils', products)).toEqual([['cola-zero', 2], ['pils', 3]])
  })

  it('returns an empty result for an empty or whitespace utterance', () => {
    expect(parseVoiceOrder('', KERMIS)).toEqual({ lines: [], unmatched: [] })
    expect(parseVoiceOrder('   ', KERMIS)).toEqual({ lines: [], unmatched: [] })
  })
})

describe('parseVoiceOrder — matching product titles', () => {
  it('matches case-insensitively', () => {
    expect(linesOf('Twee PILS')).toEqual([['pils', 2]])
  })

  it('matches ignoring diacritics', () => {
    const products = [p('cafe', 'Café')]
    expect(linesOf('twee cafe', products)).toEqual([['cafe', 2]])
  })

  it('normalizes Dutch plurals and diminutives onto the title', () => {
    expect(linesOf('twee pilsjes')).toEqual([['pils', 2]])
    expect(linesOf('drie koffietjes')).toEqual([['koffie', 3]])
    expect(linesOf('twee hamburgers')).toEqual([['hamburger', 2]])
  })

  it('matches a spoken stem against a diminutive title ("friet" → Frietjes)', () => {
    expect(linesOf('een friet')).toEqual([['frietjes', 1]])
  })

  it('tolerates one-off STT misspellings', () => {
    expect(linesOf('twee pilz')).toEqual([['pils', 2]])
    expect(linesOf('een koffi')).toEqual([['koffie', 1]])
  })

  it('matches multi-word titles as a whole', () => {
    const products = [...KERMIS, p('cola-zero', 'Cola Zero')]
    expect(linesOf('twee cola zero', products)).toEqual([['cola-zero', 2]])
  })

  it('reports exact matches with confidence 1 and carries the matched text', () => {
    const { lines } = parseVoiceOrder('twee pils', KERMIS)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.confidence).toBe(1)
    expect(lines[0]!.matchedText).toContain('pils')
  })
})

describe('parseVoiceOrder — never guess, never drop', () => {
  it('reports an unrecognized segment as unmatched instead of dropping it', () => {
    const result = parseVoiceOrder('twee pils en een flurbel', KERMIS)
    expect(result.lines.map(l => [l.product.id, l.quantity])).toEqual([['pils', 2]])
    expect(result.unmatched).toHaveLength(1)
    expect(result.unmatched[0]).toContain('flurbel')
  })

  it('prefers unmatched over a low-confidence guess', () => {
    // Nothing in the catalog resembles this — it must not land on any product.
    const result = parseVoiceOrder('twee xylofoons', KERMIS)
    expect(result.lines).toEqual([])
    expect(result.unmatched).toHaveLength(1)
  })

  it('never matches inactive products', () => {
    const products = [p('pils', 'Pils', false), p('koffie', 'Koffie')]
    const result = parseVoiceOrder('twee pils en een koffie', products)
    expect(result.lines.map(l => l.product.id)).toEqual(['koffie'])
    expect(result.unmatched).toHaveLength(1)
  })
})

describe('classifyVoiceError — report real failures, swallow benign pauses', () => {
  it('returns null when there is no error', () => {
    expect(classifyVoiceError(undefined)).toBeNull()
    expect(classifyVoiceError({})).toBeNull()
  })

  it('swallows benign codes (pause / mic-off / no-match) — report=false', () => {
    for (const code of ['no-speech', 'aborted', 'no-match']) {
      expect(classifyVoiceError({ error: code })).toMatchObject({ code, report: false })
    }
  })

  it('reports real failures the helper must act on — report=true', () => {
    for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']) {
      expect(classifyVoiceError({ error: code })).toMatchObject({ code, report: true })
    }
  })

  it('carries the engine message through for diagnostics', () => {
    expect(classifyVoiceError({ error: 'network', message: 'down' }))
      .toEqual({ code: 'network', message: 'down', report: true })
  })
})
