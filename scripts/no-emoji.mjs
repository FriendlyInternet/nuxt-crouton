/**
 * no-emoji.mjs — owner-facing text uses plain words, not emoji (#2534).
 * Applied to the final digest/mail output so every glyph in the templates is covered once.
 */
const WORDS = [[/⛔/gu, '(blocked)'], [/⚠️?/gu, 'Warning:']]

export function stripEmoji(text) {
  let s = String(text ?? '')
  for (const [re, word] of WORDS) s = s.replace(re, word)
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[ \t]+(?=\n)/g, '')
    .replace(/<(h2|div|td|span|summary)([^>]*)>\s{2,}/g, '<$1$2>')
}
