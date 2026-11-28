/**
 * Config utilities for crouton-i18n layer.
 *
 * These are duplicated from @fyit/crouton/src/module.ts to avoid a build-time
 * dependency on the main package (which requires `unbuild` to produce dist/).
 * This file is loaded by nuxt.config.ts at config resolution time, before any
 * packages are built.
 */
import { createJiti } from 'jiti'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

interface CroutonLocaleObject {
  code: string
  name?: string
  file?: string
}

interface CroutonConfig {
  locales?: (string | CroutonLocaleObject)[]
  defaultLocale?: string
  features?: Record<string, unknown>
}

/** Well-known ISO 639-1 language names */
const KNOWN_LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  nl: 'Nederlands',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ar: 'العربية',
  ru: 'Русский',
  pl: 'Polski',
  tr: 'Türkçe',
  sv: 'Svenska',
  da: 'Dansk',
  nb: 'Norsk Bokmål',
  fi: 'Suomi',
  cs: 'Čeština',
  uk: 'Українська',
}

// Default locale set when an app's crouton.config.js doesn't declare `locales`.
// This matches the locales the crouton packages historically hardcoded
// (en/nl/fr), so apps that never opted into a specific locale set keep all
// three. Apps that DO declare `locales` (e.g. `['nl']`) get exactly that set.
const DEFAULT_LOCALES: { code: string, name: string, file: string }[] = [
  { code: 'en', name: 'English', file: 'en.json' },
  { code: 'nl', name: 'Nederlands', file: 'nl.json' },
  { code: 'fr', name: 'Français', file: 'fr.json' },
]

function loadCroutonConfig(): CroutonConfig | null {
  const jiti = createJiti(import.meta.url)
  const extensions = ['.js', '.mjs', '.cjs', '.ts']
  const baseName = 'crouton.config'

  for (const ext of extensions) {
    const configPath = resolve(process.cwd(), `${baseName}${ext}`)
    if (existsSync(configPath)) {
      try {
        const mod = jiti(configPath) as { default?: CroutonConfig } | CroutonConfig
        return ('default' in mod && mod.default ? mod.default : mod) as CroutonConfig
      }
      catch {
        // Ignore parse errors
      }
    }
  }
  return null
}

export function getCroutonLocales(): { code: string, name: string, file: string }[] {
  const config = loadCroutonConfig()
  if (!config?.locales || config.locales.length === 0) {
    return DEFAULT_LOCALES
  }

  return config.locales.map((entry) => {
    if (typeof entry === 'string') {
      return {
        code: entry,
        name: KNOWN_LOCALE_NAMES[entry] || entry.toUpperCase(),
        file: `${entry}.json`,
      }
    }
    return {
      code: entry.code,
      name: entry.name || KNOWN_LOCALE_NAMES[entry.code] || entry.code.toUpperCase(),
      file: entry.file || `${entry.code}.json`,
    }
  })
}

/**
 * The app's locales as one layer should declare them to @nuxtjs/i18n.
 * A locale whose `{code}.json` exists in `langDir` keeps its `file`; one the
 * layer ships no texts for gets `files: []` — a missing file would crash
 * startup (ENOENT), and a locale with neither key is refused under a langDir.
 * That layer's texts then fall back to the default locale.
 */
export function getLayerLocales(langDir: string): ({ code: string, name: string, file: string } | { code: string, name: string, files: string[] })[] {
  return getCroutonLocales().map(({ code, name, file }) =>
    existsSync(resolve(langDir, file)) ? { code, name, file } : { code, name, files: [] as string[] })
}

export function getCroutonDefaultLocale(): string {
  const config = loadCroutonConfig()
  return config?.defaultLocale || 'en'
}