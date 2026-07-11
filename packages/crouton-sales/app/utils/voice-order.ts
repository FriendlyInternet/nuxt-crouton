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

export interface VoiceOrderLine {
  product: VoiceOrderProduct
  quantity: number
  /** The utterance segment this line was parsed from — shown to the helper so
   * they can judge what the mic heard. */
  matchedText: string
  /** 0..1 — 1 is an exact (normalized) title match. Drives UI emphasis for
   * shaky matches; never used to auto-submit. */
  confidence: number
}

export interface VoiceOrderParseResult {
  lines: VoiceOrderLine[]
  /** Utterance segments that matched no product confidently enough. Never
   * silently dropped — the helper must see what wasn't understood. */
  unmatched: string[]
}

/**
 * Parse a spoken order like "twee pils en een koffie" against the event's
 * products. Dutch-first: number words (een/één..twintig + tientallen), digit
 * quantities, "en"/comma separators, filler words, plural/diminutive
 * normalization, and light fuzz for STT misspellings.
 */
export function parseVoiceOrder(
  utterance: string,
  products: VoiceOrderProduct[]
): VoiceOrderParseResult {
  throw new Error('Not implemented — behaviour under test sign-off (#1429)')
}
