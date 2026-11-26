/**
 * #4562 — the composed list block (Layout/List.vue) hands its bookings to
 * CroutonBookingsList, so the inner list can't refresh data it doesn't own. After a
 * booking is edited or cancelled the inner list emits `updated` (both paths go through
 * handleBookingUpdated); the block must answer it by refreshing its own shared fetch,
 * or the list (and a calendar block on the same fetch) keeps showing the old state.
 * Reads the real .vue files (the SFCs need the Nuxt UI runtime to mount), same style
 * as list-toggles-template.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const ELEMENT = 1
const DIRECTIVE = 7

function load(name: string) {
  const file = resolve(__dirname, `../app/components/${name}`)
  const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file })
  expect(errors).toEqual([])
  return { script: descriptor.scriptSetup?.content ?? '', ast: descriptor.template!.ast! }
}

function findAll(node: any, tag: string): any[] {
  return (node.children ?? []).filter((c: any) => c.type === ELEMENT)
    .flatMap((c: any) => [...(c.tag === tag ? [c] : []), ...findAll(c, tag)])
}

const onHandler = (node: any, event: string): string | undefined =>
  (node.props ?? []).find((p: any) => p.type === DIRECTIVE && p.name === 'on' && p.arg?.content === event)?.exp?.content

describe('Layout/List.vue refreshes after a booking changes (#4562)', () => {
  it('L1 handles @updated on CroutonBookingsList by calling refresh() from its useBookingsList', () => {
    const { script, ast } = load('Layout/List.vue')
    const lists = findAll(ast, 'CroutonBookingsList')
    expect(lists).toHaveLength(1)
    const handler = onHandler(lists[0], 'updated')
    expect(handler, '@updated is wired').toBeDefined()
    expect(handler).toMatch(/^refresh(\(\))?$/)
    // refresh is the one returned by this block's own useBookingsList({ scope })
    expect(script).toMatch(/const\s*\{[^}]*\brefresh\b[^}]*\}\s*=\s*useBookingsList\(\{\s*scope:/)
  })

  it('L2 the inner list emits `updated` after both an edit and a cancel', () => {
    const { script, ast } = load('List.vue')
    const editCards = findAll(ast, 'CroutonBookingsBookingCreateCard').filter(n => onHandler(n, 'cancelled'))
    expect(editCards.length).toBeGreaterThan(0)
    for (const card of editCards) {
      expect(onHandler(card, 'updated')).toBe('handleBookingUpdated')
      expect(onHandler(card, 'cancelled')).toBe('handleBookingUpdated')
    }
    expect(script).toMatch(/function handleBookingUpdated\(\)\s*\{[^}]*emit\('updated'\)/)
  })
})
