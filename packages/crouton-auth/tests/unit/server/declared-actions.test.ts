// @vitest-environment node
/**
 * Every #4104 action is declared by the package that guards it (#4104, Qodo #1)
 *
 * Reads the real `app/app.config.ts` of each owning package and its real
 * en/fr/nl locale files: the action must sit in that package's `croutonActions`
 * with a label key, and the key must resolve in all three languages. Nothing is
 * mocked — this is the corpus the roles screen reads.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CROUTON_DEFAULT_ACTIONS } from '../../../server/lib/access'

const PACKAGES = resolve(__dirname, '../../../..')

const TABLE: Record<string, string> = {
  'admin:access': 'crouton-admin',
  'team:manage': 'crouton-auth',
  'team:domains': 'crouton-auth',
  'site:manage': 'crouton-core',
  'collections:manage': 'crouton-core',
  'translations:manage': 'crouton-i18n',
  'pages:edit': 'crouton-pages',
  'media:manage': 'crouton-assets',
  'activity:view': 'crouton-events',
  'bookings:create': 'crouton-bookings',
  'bookings:manage': 'crouton-bookings',
  'sales:manage': 'crouton-sales'
}

function localeDir(pkg: string): string {
  const nested = join(PACKAGES, pkg, 'i18n/locales')
  return existsSync(nested) ? nested : join(PACKAGES, pkg, 'locales')
}

function lookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)
}

describe('each action is declared, with fr/nl/en labels, by its own package', () => {
  for (const [action, pkg] of Object.entries(TABLE)) {
    it(`${action} → ${pkg}`, () => {
      const src = readFileSync(join(PACKAGES, pkg, 'app/app.config.ts'), 'utf8')
      const match = src.match(new RegExp(`'${action}':\\s*\\{\\s*label:\\s*'([^']+)'`))
      expect(match, `${pkg}/app/app.config.ts declares ${action}`).not.toBeNull()
      expect(src).toContain('croutonActions')
      const key = match![1]!
      for (const lang of ['en', 'fr', 'nl']) {
        const messages = JSON.parse(readFileSync(join(localeDir(pkg), `${lang}.json`), 'utf8'))
        expect(typeof lookup(messages, key), `${pkg} ${lang}.json has ${key}`).toBe('string')
      }
    })
  }

  it('crouton-auth only builds in the fallback, not the packages\' actions', () => {
    expect([...CROUTON_DEFAULT_ACTIONS].sort()).toEqual(['admin:access', 'team:manage'])
  })
})
