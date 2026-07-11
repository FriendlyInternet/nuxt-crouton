/**
 * @crouton-package crouton-sales
 * @description Talk-to-order parsing — maps a spoken utterance (nl) onto an
 * event's products as draft cart lines. Pure logic, no Vue/browser deps: the
 * speech capture lives in useVoiceOrder(); this module only turns text into
 * matched (product, quantity) lines for the helper to review. (#1429)
 */

/** The slice of SalesProduct the parser needs — kept narrow so tests and
 * non-cart callers don't have to build full product rows. */
export interface VoiceOrderProduct {
  id: string
  title: string
  /** Inactive products never match (mirrors the POS grid). */
  isActive?: boolean
}

export interface VoiceOrderLine<T extends VoiceOrderProduct = VoiceOrderProduct> {
  product: T
  quantity: number
  /** The utterance segment this line was parsed from — shown to the helper so
   * they can judge what the mic heard. */
  matchedText: string
  /** 0..1 — 1 is an exact (normalized) title match. Drives UI emphasis for
   * shaky matches; never used to auto-submit. */
  confidence: number
}

export interface VoiceOrderParseResult<T extends VoiceOrderProduct = VoiceOrderProduct> {
  lines: VoiceOrderLine<T>[]
  /** Utterance segments that matched no product confidently enough. Never
   * silently dropped — the helper must see what wasn't understood. */
  unmatched: string[]
}

/** Web Speech API `SpeechRecognitionErrorEvent.error` code. Wide union so
 * callers can branch on the actionable ones. */
export type VoiceOrderErrorCode =
  | 'no-speech' | 'aborted' | 'no-match'
  | 'not-allowed' | 'service-not-allowed'
  | 'audio-capture' | 'network' | 'language-not-supported'
  | 'bad-grammar' | (string & {})

/** Recognition-error codes we treat as normal, not failures: the helper paused
 * (no-speech), tapped the mic off (aborted), or the engine matched nothing
 * (no-match). A pause during a rush is expected, not an error — these must NOT
 * raise a "failed" message. (#1429) */
const BENIGN_VOICE_ERRORS = new Set(['no-speech', 'aborted', 'no-match'])

export interface VoiceErrorClassification {
  code: VoiceOrderErrorCode
  message: string
  /** True for a real failure the helper should be told about (permission /
   * mic / network / unsupported language); false for a benign pause. */
  report: boolean
}

/**
 * Classify a `SpeechRecognitionErrorEvent` into "log it, and maybe tell the
 * helper". Pure so the decision is unit-testable; the composable only wires it
 * to the toast. Returns null when there's no error code to act on.
 */
export function classifyVoiceError(
  event: { error?: string, message?: string } | undefined
): VoiceErrorClassification | null {
  const code = event?.error
  if (!code) return null
  return {
    code: code as VoiceOrderErrorCode,
    message: event?.message || '',
    report: !BENIGN_VOICE_ERRORS.has(code)
  }
}

// Dutch number words. Covers the kassa reality (1–20 + round tens); anything
// larger arrives as digits from the STT anyway.
const NUMBER_WORDS: Record<string, number> = {
  een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8,
  negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14,
  vijftien: 15, zestien: 16, zeventien: 17, achttien: 18, negentien: 19,
  twintig: 20, dertig: 30, veertig: 40, vijftig: 50, zestig: 60,
  zeventig: 70, tachtig: 80, negentig: 90, honderd: 100
}

// Polite noise around an order ("doe maar twee pils alsjeblieft"). "een" is
// deliberately NOT here — it's quantity 1.
const FILLER_WORDS = new Set([
  'doe', 'maar', 'alsjeblieft', 'alstublieft', 'aub', 'graag', 'ook', 'nog',
  'mag', 'ik', 'wil', 'we', 'wij', 'u', 'je', 'even', 'dan', 'voor', 'mij',
  'ons', 'de', 'het', 'die', 'dat', 'keer', 'x'
])

// A match below this similarity is reported as unmatched instead of guessed.
// Calibrated to accept one STT edit on a short word ("pilz" → "pils" = 0.75)
// while rejecting unrelated words.
const MIN_CONFIDENCE = 0.72

/** lowercase + strip diacritics ("Café" → "cafe", "één" → "een") */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Strip Dutch plural/diminutive endings so "pilsjes"/"koffietjes"/"friet"
 * and their titles land on a comparable stem. Longest suffix first; keep at
 * least 3 chars so short words survive. */
function stemWord(word: string): string {
  for (const suffix of ['tjes', 'tje', 'jes', 'je', 'en', 's']) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length)
    }
  }
  return word
}

function stemPhrase(phrase: string): string {
  return phrase.split(' ').map(stemWord).join(' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const insertOrDelete = Math.min(prev[j]!, prev[j - 1]!) + 1
      const substitute = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      diagonal = prev[j]!
      prev[j] = Math.min(insertOrDelete, substitute)
    }
  }
  return prev[b.length]!
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

/** Best similarity across raw-normalized and stemmed forms of both sides. */
function scoreAgainstTitle(phrase: string, title: string): number {
  const phraseStem = stemPhrase(phrase)
  const titleStem = stemPhrase(title)
  return Math.max(
    similarity(phrase, title),
    similarity(phraseStem, titleStem),
    similarity(phraseStem, title),
    similarity(phrase, titleStem)
  )
}

interface Segment {
  raw: string
  quantity: number
  /** normalized product phrase, fillers and the quantity token removed */
  phrase: string
}

/** Normalized word tokens with punctuation and filler words removed. */
function tokenize(raw: string): string[] {
  return normalize(raw)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(t => t && !FILLER_WORDS.has(t))
}

/** Numeric value of a quantity token (digit or nl number word), or null. */
function quantityValue(token: string): number | null {
  const value = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token]
  return value !== undefined && value > 0 ? value : null
}

/**
 * Break the utterance into per-item segments. Boundaries are "en"/commas AND a
 * new quantity token: helpers often list items with no "en" between them
 * ("100 frisdrank 100 koffie"), so a quantity appearing after a product phrase
 * has begun starts the next item. A multi-word title with no number inside it
 * ("cola zero") stays whole.
 */
function segment(utterance: string): Segment[] {
  const segments: Segment[] = []
  // Commas act like "en"; tokenize keeps "en" (not a filler word) as a marker.
  const tokens = tokenize(utterance.replace(/,/g, ' en '))

  let quantity: number | null = null
  let words: string[] = []
  const flush = () => {
    const phraseTokens = words.filter(w => quantityValue(w) === null)
    if (!words.length && quantity === null) return // pure filler
    segments.push({ raw: words.join(' '), quantity: quantity ?? 1, phrase: phraseTokens.join(' ') })
    quantity = null
    words = []
  }

  for (const token of tokens) {
    if (token === 'en') { flush(); continue }
    const value = quantityValue(token)
    // A quantity that opens a NEW item (we already have one, or a phrase started)
    // closes the current segment first.
    if (value !== null && (quantity !== null || words.length)) flush()
    if (value !== null) quantity = value
    words.push(token)
  }
  flush()
  return segments
}

/**
 * Parse a spoken order like "twee pils en een koffie" against the event's
 * products. Dutch-first: number words (een/één..twintig + tientallen), digit
 * quantities, "en"/comma separators, filler words, plural/diminutive
 * normalization, and light fuzz for STT misspellings. Unrecognized segments
 * come back in `unmatched` — never silently dropped, never guessed.
 */
export function parseVoiceOrder<T extends VoiceOrderProduct>(
  utterance: string,
  products: T[]
): VoiceOrderParseResult<T> {
  const candidates = products
    .filter(p => p.isActive !== false)
    .map(p => ({ product: p, title: normalize(p.title) }))

  const lines: VoiceOrderLine<T>[] = []
  const unmatched: string[] = []

  for (const seg of segment(utterance)) {
    let best: { product: T, score: number } | null = null
    for (const candidate of candidates) {
      const score = scoreAgainstTitle(seg.phrase, candidate.title)
      if (!best || score > best.score) best = { product: candidate.product, score }
    }

    if (!seg.phrase || !best || best.score < MIN_CONFIDENCE) {
      unmatched.push(seg.raw)
      continue
    }

    const existing = lines.find(l => l.product.id === best!.product.id)
    if (existing) {
      existing.quantity += seg.quantity
      existing.confidence = Math.min(existing.confidence, best.score)
    }
    else {
      lines.push({
        product: best.product,
        quantity: seg.quantity,
        matchedText: seg.raw,
        confidence: best.score
      })
    }
  }

  return { lines, unmatched }
}
