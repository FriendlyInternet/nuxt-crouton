import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// #4405 — controls hidden with `opacity-0` and revealed on `group-hover` stay in
// the Tab order, so a keyboard user lands on something invisible. Every such
// class string must also reveal on `focus-within` and while a menu inside it
// is open (`has-data-[state=open]`, set by Reka UI's trigger).

const componentsDir = join(import.meta.dirname, '../../app/components')

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return name.endsWith('.vue') ? [full] : []
  })
}

const QUOTES = new Set(['"', '\'', '`'])
const HOVER_TOKEN = /^group-hover(\/[\w-]+)?:opacity-100$/

/**
 * Find class strings by anchoring on each hover match and expanding to the
 * nearest quote on each side. Tailwind class strings never contain quotes, so
 * this stays in step where a left-to-right quote regex is thrown off by stray
 * apostrophes in templates and comments.
 */
function hoverClassStrings(source: string): { text: string, line: number }[] {
  const found: { text: string, line: number }[] = []
  const seen = new Set<number>()
  for (const match of source.matchAll(/group-hover(\/[\w-]+)?:opacity-100/g)) {
    let start = match.index
    while (start > 0 && !QUOTES.has(source[start - 1]!)) start--
    let end = match.index + match[0].length
    while (end < source.length && !QUOTES.has(source[end]!)) end++
    if (seen.has(start)) continue
    seen.add(start)
    const line = source.slice(0, Math.max(start - 1, 0)).split('\n').length
    found.push({ text: source.slice(start, end), line })
  }
  return found
}

describe('hover-hidden actions are reachable by keyboard (#4405)', () => {
  it('every opacity-0 + group-hover:opacity-100 string also shows on focus-within and an open menu', () => {
    const files = vueFiles(componentsDir)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const { text, line } of hoverClassStrings(source)) {
        const tokens = text.split(/\s+/)
        if (!tokens.includes('opacity-0')) continue
        if (!tokens.some(t => HOVER_TOKEN.test(t))) continue
        const ok = tokens.includes('focus-within:opacity-100')
          && tokens.includes('has-data-[state=open]:opacity-100')
        if (!ok) offenders.push(`${relative(componentsDir, file)}:${line}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
