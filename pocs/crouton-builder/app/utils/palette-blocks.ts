import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'

/**
 * Registered blocks the row leaves out by id (#2559). `bookings-filters`: in a layout
 * it shows only its ⚙️ menu — its location cards need `viewToggles`, which the layout
 * block turns off — so it fills a pane with one icon, and Bookings · Locations already
 * filters. A useful Filters block belongs to #2561.
 */
const NOT_OFFERED = new Set(['bookings-filters'])

/**
 * The blocks the Builder's block row offers (#2559): atomic blocks only, minus
 * `NOT_OFFERED`. A compound block (bookings' all-in-one `bookings-calendar`) is a
 * whole screen in one pane — its parts are offered as their own blocks instead.
 * Saved pages that already hold one still render, because the registry itself is
 * left untouched.
 */
export function paletteBlocksOf<T extends Pick<CroutonLayoutBlockDefinition, 'kind' | 'id'>>(blocks: T[]): T[] {
  return blocks.filter(b => b.kind !== 'compound' && !NOT_OFFERED.has(b.id))
}
