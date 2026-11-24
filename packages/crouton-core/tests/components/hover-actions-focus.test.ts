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
function quoteStart(source: string, from: number): number {
  let start = from
  while (start > 0 && !QUOTES.has(source[start - 1]!)) start--
  return start
}

function quoteEnd(source: string, from: number): number {
  let end = from
  while (end < source.length && !QUOTES.has(source[end]!)) end++
  return end
}

function hoverClassStrings(source: string): { text: string, line: number }[] {
  const found = new Map<number, { text: string, line: number }>()
  for (const match of source.matchAll(/group-hover(\/[\w-]+)?:opacity-100/g)) {
    const start = quoteStart(source, match.index)
    const end = quoteEnd(source, match.index + match[0].length)
    const line = source.slice(0, Math.max(start - 1, 0)).split('\n').length
    if (!found.has(start)) found.set(start, { text: source.slice(start, end), line })
  }
  return [...found.values()]
}

/** A hover-revealed hidden string that does not also reveal on focus and open menu. */
function isOffender(text: string): boolean {
  const tokens = text.split(/\s+/)
  if (!tokens.includes('opacity-0') || !tokens.some(t => HOVER_TOKEN.test(t))) return false
  return !(tokens.includes('focus-within:opacity-100') && tokens.includes('has-data-[state=open]:opacity-100'))
}

function offendersIn(file: string): string[] {
  return hoverClassStrings(readFileSync(file, 'utf8'))
    .filter(({ text }) => isOffender(text))
    .map(({ line }) => `${relative(componentsDir, file)}:${line}`)
}

describe('hover-hidden actions are reachable by keyboard (#4405)', () => {
  it('every opacity-0 + group-hover:opacity-100 string also shows on focus-within and an open menu', () => {
    const files = vueFiles(componentsDir)
    expect(files.length).toBeGreaterThan(0)

    expect(files.flatMap(offendersIn)).toEqual([])
  })
})
