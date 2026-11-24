/**
 * #4112 — the booking card: locations as one sideways-scrolling UTabs row, product
 * buttons via showProductPicker, slots with the number free, an amount box at every
 * location, and an edit that sends product + quantity. Reads the real
 * BookingCreateCard.vue and checks that shape (same style as calendar-single-popover.test.ts).
 * #4314: also compiles the script and checks the form draws without waiting (no async setup).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'

const file = resolve(__dirname, '../app/components/BookingCreateCard.vue')
const source = readFileSync(file, 'utf8')
const { descriptor } = parse(source, { filename: file })
const ast = descriptor.template!.ast!
const script = descriptor.scriptSetup!.content
const template = descriptor.template!.content

const ELEMENT = 1
const DIRECTIVE = 7

type Node = any

function walk(node: Node, ancestors: Node[], visit: (n: Node, anc: Node[]) => void) {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT) continue
    visit(child, ancestors)
    walk(child, [...ancestors, child], visit)
  }
}

function find(tag: string): { node: Node, anc: Node[] }[] {
  const hits: { node: Node, anc: Node[] }[] = []
  walk(ast, [], (n, anc) => { if (n.tag === tag) hits.push({ node: n, anc }) })
  return hits
}

function bound(node: Node, arg: string): string | undefined {
  const p = (node.props ?? []).find((p: Node) => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === arg)
  return p?.exp?.content
}

describe('BookingCreateCard.vue (#4112)', () => {
  // covers: T3
  // #4471: the row is the shared CroutonBookingsLocationTabs (its classes are pinned in location-tabs-template.test.ts)
  it('locations are the shared tab row, with no "All" and no "+"', () => {
    const rows = find('CroutonBookingsLocationTabs')
    expect(rows).toHaveLength(1)
    const names = (rows[0]!.node.props ?? []).map((p: Node) => p.type === DIRECTIVE ? p.arg?.content : p.name)
    expect(names).not.toContain('show-all')
    expect(names).not.toContain('can-add')
    expect(names).not.toContain('showAll')
    expect(names).not.toContain('canAdd')
    expect(find('UTabs')).toHaveLength(0)
    expect(template).not.toContain('w-52')
  })

  // covers: T3
  it('uses Nuxt UI only: no raw <button> or <input>', () => {
    expect(find('button')).toHaveLength(0)
    expect(find('input')).toHaveLength(0)
  })

  // covers: T3
  it('the amount box is not hidden behind !hasSlots', () => {
    const inputs = find('UInputNumber')
    expect(inputs).toHaveLength(1)
    const conds = inputs[0]!.anc.flatMap((a: Node) => (a.props ?? [])
      .filter((p: Node) => p.type === DIRECTIVE && (p.name === 'if' || p.name === 'else-if' || p.name === 'show'))
      .map((p: Node) => p.exp?.content ?? ''))
    expect(conds.some((c: string) => c.includes('!hasSlots'))).toBe(false)
  })

  // covers: T3
  it('no "left" / "of N available" text on screen', () => {
    expect(source).not.toContain('createCard.left')
    expect(source).not.toContain('ofAvailable')
  })

  // covers: T3
  it('shows product buttons through showProductPicker and saves an edit with editBookingBody', () => {
    expect(script).toContain('showProductPicker(')
    expect(script).toContain('editBookingBody(')
  })
})

// #4314: pressing edit swapped the booking card for this form, and the form drew nothing until
// an awaited product-list request answered (an async setup), so the booking vanished for a moment.
describe('BookingCreateCard.vue draws at once (#4314)', () => {
  // covers: T1
  it('is not an async component: the compiled setup has no withAsyncContext / async setup(', () => {
    const compiled = compileScript(descriptor, { id: 'booking-create-card' }).content
    expect(compiled).not.toContain('withAsyncContext')
    expect(compiled).not.toContain('async setup(')
  })

  // covers: T2
  it('reads teamProducts from useBookingCart() and no longer calls useCollectionQuery', () => {
    expect(script).not.toContain('useCollectionQuery')
    const destructure = script.match(/const\s*\{([^}]*)\}\s*=\s*useBookingCart\(\)/)
    expect(destructure).not.toBeNull()
    expect(destructure![1]).toMatch(/\bteamProducts\b/)
  })
})

// #4331: the first location switch in an edit kept the old slot (the setup guard was never
// spent), the group survived a switch, and with nothing free the amount box drew "1/0".
const isElement = (n: Node) => n.type === ELEMENT

/** The expression of a directive on a node ('' for one without), or undefined when absent */
function directive(node: Node, name: string): string | undefined {
  const p = node.props.find((p: Node) => p.type === DIRECTIVE && p.name === name)
  return p && (p.exp?.content ?? '')
}

describe('BookingCreateCard.vue (#4331)', () => {
  // covers: T3
  it('ends the edit guard on mount and the location watcher clears the group', () => {
    const compiled = compileScript(descriptor, { id: 'booking-create-card' }).content
    expect(compiled).toMatch(/onMounted\(\s*\(\)\s*=>\s*\{\s*isInitialEditSetup\.value\s*=\s*false/)
    const watcher = script.match(/watch\(localLocationId,[\s\S]*?\n\}\)/)
    expect(watcher).not.toBeNull()
    expect(watcher![0]).toContain('localGroupId.value = null')
  })

  // covers: T4
  it('with nothing free the amount area shows "Fully booked" instead of a number', () => {
    const inputs = find('UInputNumber')
    expect(inputs).toHaveLength(1)
    const { anc } = inputs[0]!
    const wrapper = anc.at(-1)
    const vIf = directive(wrapper, 'if')
    expect(vIf).toContain('maxQuantity >= 1')
    expect(vIf).toContain('availabilityLoading')
    // the /N label lives inside that same branch
    expect(wrapper.loc.source).toContain('/{{ maxQuantity }}')
    // its v-else sibling is the full badge
    const siblings = anc.at(-2).children.filter(isElement)
    const next = siblings[siblings.indexOf(wrapper) + 1]
    expect(next.tag).toBe('UBadge')
    expect(directive(next, 'else')).toBeDefined()
    expect(next.loc.source).toContain('bookings.calendar.fullyBooked')
    // Save stays off when it doesn't fit
    expect(template).toMatch(/:disabled="!canSubmit/)
  })
})
