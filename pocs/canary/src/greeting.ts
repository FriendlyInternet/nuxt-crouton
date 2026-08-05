// The canary rig's typecheck surface (#1878).
//
// Two canaries drive the acceptance gate through this file, and they need OPPOSITE outcomes:
//   • app-acceptance-pass — a change here must typecheck clean  → `acceptance: passed`
//   • acceptance-red      — a change here must NOT typecheck    → `acceptance: FAILED` + draft PR
//
// So the types are deliberately tight (`Locale` is a union, not `string`). A worker asked to add
// a locale without widening the union produces a REAL type error — the red canary needs a genuine
// failure, not a staged one, or it proves nothing about the gate.
//
// Everything in this folder is disposable. See README.md before "fixing" anything here.

export type Locale = 'nl' | 'en' | 'fr'

export interface Greeting {
  locale: Locale
  text: string
}

const GREETINGS: Record<Locale, string> = {
  nl: 'Hallo',
  en: 'Hello',
  fr: 'Bonjour',
  de: 'Hallo'
}

/** Greet in `locale`. Total over `Locale` by construction — no runtime fallback needed. */
export function greet(locale: Locale, name: string): Greeting {
  return { locale, text: `${GREETINGS[locale]}, ${name}!` }
}

/** The locales this poc can greet in, in a stable order. */
export function supportedLocales(): Locale[] {
  return Object.keys(GREETINGS) as Locale[]
}
