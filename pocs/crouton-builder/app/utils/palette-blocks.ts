import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'

/**
 * The blocks the Builder's block row offers (#2559): atomic blocks only. A compound
 * block (bookings' all-in-one `bookings-calendar`) is a whole screen in one pane —
 * its parts are offered as their own blocks instead. Saved pages that already hold
 * one still render, because the registry itself is left untouched.
 */
export function paletteBlocksOf<T extends Pick<CroutonLayoutBlockDefinition, 'kind'>>(blocks: T[]): T[] {
  return blocks.filter(b => b.kind !== 'compound')
}
