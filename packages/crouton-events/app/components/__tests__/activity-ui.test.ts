import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { parse } from 'vue/compiler-sfc'

// #4036: the Activité page is built from Nuxt UI parts, in the admin's language.

const componentsDir = fileURLToPath(new URL('..', import.meta.url))
const pagePath = fileURLToPath(new URL('../../pages/admin/[team]/activity.vue', import.meta.url))
const localesDir = fileURLToPath(new URL('../../../i18n/locales/', import.meta.url))

const componentFiles = readdirSync(componentsDir)
  .filter(f => f.endsWith('.vue'))
  .map(f => `${componentsDir}${f}`)
const allFiles = [...componentFiles, pagePath]
const read = (path: string) => readFileSync(path, 'utf8')

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )
}

const locales = Object.fromEntries(['fr', 'nl', 'en'].map(code => [
  code,
  new Set(flatten(JSON.parse(read(`${localesDir}${code}.json`))))
]))

// Node types from @vue/compiler-core: 1 = ELEMENT, 2 = TEXT
function textNodes(node: any, out: string[] = []): string[] {
  if (node.type === 2 && node.content.trim()) out.push(node.content.trim())
  for (const child of node.children ?? []) textNodes(child, out)
  for (const branch of node.branches ?? []) textNodes(branch, out)
  return out
}

describe('activity i18n (#4036)', () => {
  // covers: T2
  it('fr, nl and en carry the same events.* keys', () => {
    expect([...locales.nl!].sort()).toEqual([...locales.fr!].sort())
    expect([...locales.en!].sort()).toEqual([...locales.fr!].sort())
  })

  // covers: T2
  it('every events.* key used by the components and the page exists in all three locales', () => {
    const used = new Set<string>()
    const prefixes = new Set<string>()
    for (const file of allFiles) {
      const src = read(file)
      for (const m of src.matchAll(/\$?t\(\s*'(events\.[\w.]+)'/g)) used.add(m[1]!)
      for (const m of src.matchAll(/\$?t\(\s*`(events\.[\w.]+)\.\$\{/g)) prefixes.add(m[1]!)
    }
    expect(used.size).toBeGreaterThan(10)
    for (const [code, keys] of Object.entries(locales)) {
      const missing = [...used].filter(k => !keys.has(k))
      expect(missing, `missing in ${code}.json`).toEqual([])
    }
    // dynamic keys, e.g. t(`events.operation.${op}`)
    for (const prefix of prefixes) {
      for (const op of ['create', 'update', 'delete']) {
        for (const [code, keys] of Object.entries(locales)) {
          expect(keys.has(`${prefix}.${op}`), `${prefix}.${op} in ${code}.json`).toBe(true)
        }
      }
    }
  })
})

describe('activity components use Nuxt UI, theme colours only (#4036)', () => {
  // covers: T3
  it.each(allFiles.map(f => [f.split('/').slice(-1)[0], f]))('%s has no hand-built table/button, hard-coded colour, en-US or bare English text', (_name, file) => {
    const src = read(file as string)
    expect(src).not.toMatch(/<table\b/)
    expect(src).not.toMatch(/<button\b/)
    expect(src).not.toMatch(/\b(?:text|bg|ring|border)-(?:red|green|blue)-\d{2,3}\b/)
    expect(src).not.toMatch(/'en-US'/)

    const { descriptor, errors } = parse(src)
    expect(errors).toEqual([])
    const words = textNodes(descriptor.template!.ast).filter(text => /[a-z]/i.test(text))
    expect(words).toEqual([])
  })

  // covers: T3
  it('the timeline renders a UTimeline and the old hand-built item is gone', () => {
    expect(read(`${componentsDir}CroutonActivityTimeline.vue`)).toMatch(/<UTimeline\b/)
    expect(componentFiles.some(f => f.endsWith('CroutonActivityTimelineItem.vue'))).toBe(false)
  })
})
