// compose-layout.ts — the deterministic default-layout step of the generate → POC
// pipeline (Sprint 4, #709).
//
// After collections are generated, run the SAME pure rule set the Nuxt runtime
// uses (`composeDefaultLayout` from crouton-core) to arrange them into a viable
// default layout, and write it as `crouton.layout.json` at the app root. The seed
// runner (`seed-app.ts`) upserts that tree into the `layout_configs` table, so a
// freshly seeded POC boots with a real, data-bound layout instead of a blank
// canvas — "I want a booking app" ends laid out.
//
// The layout is DATA (a `layout_configs` tree), not generated `.vue`: it
// round-trips through `CroutonLayout` and the UI sign-off loop can regenerate it.
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { toCase } from './utils/helpers.ts'
import { composeDefaultLayout, type ComposeCollectionInput } from '@fyit/crouton-layout/app/utils/layout-compose'
// Layout TYPES intentionally stay in crouton-core (shared contract); only the
// implementation moved to @fyit/crouton-layout (#751).
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

/**
 * The block sizing contracts the placer reads. The CLI has no live `app.config`
 * at generate time, so we mirror the real registries here. Keep in sync with
 * `crouton-core/app/app.config.ts` and `crouton-bookings/app/app.config.ts`.
 */
const CORE_BLOCKS: CroutonLayoutBlockRegistry = {
  'collection-list': {
    id: 'collection-list', name: 'List', description: '', icon: 'i-lucide-list',
    component: 'CroutonLayoutCollection', minWidth: 260, defaultSize: 34,
  },
  'entity-form': {
    id: 'entity-form', name: 'Form', description: '', icon: 'i-lucide-square-pen',
    component: 'CroutonLayoutForm', minWidth: 320, defaultSize: 50,
  },
}
const BOOKINGS_BLOCKS: CroutonLayoutBlockRegistry = {
  'bookings-calendar': {
    id: 'bookings-calendar', name: 'Calendar', description: '', icon: 'i-lucide-calendar',
    component: 'CroutonBookingsLayoutCalendar', minWidth: 520, defaultSize: 65,
  },
}

/** camelCase a layer name the same way the generator does (registry key prefix). */
function layerCamel(layer: string): string {
  return layer
    .split(/[-_]/)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

/** The collection's registry key, e.g. `bookingsBookings` (matches the generated composable/config). */
export function registryKeyFor(layer: string, collection: string): string {
  return `${layerCamel(layer)}${toCase(collection).pascalCasePlural}`
}

/** Is the bookings package in play (feature flag on, or a collection landed in the `bookings` layer)? */
function bookingsEnabled(
  features: Record<string, unknown> | undefined,
  collections: GeneratedCollection[],
): boolean {
  if (features && features.bookings) return true
  return collections.some(c => c.layer === 'bookings')
}

/** Does this collection carry the bookings calendar (so the placer picks calendar-primary)? */
function isCalendarCollection(c: GeneratedCollection): boolean {
  return c.layer === 'bookings' && /booking/i.test(c.name)
}

export interface GeneratedCollection {
  name: string
  layer: string
}

export interface WriteDefaultLayoutOptions {
  /** The collections just generated (name + layer). */
  allCollections: GeneratedCollection[]
  /** The config `features` block (to detect bookings even before its collection lands). */
  features?: Record<string, unknown>
  /** App directory (defaults to cwd). */
  cwd?: string
  /** Don't write — just compute (returns the chosen pattern). */
  dryRun?: boolean
  /** Output filename (default `crouton.layout.json`). */
  outFile?: string
}

export interface WriteDefaultLayoutResult {
  written: boolean
  pattern?: string
  viable?: boolean
  path?: string
  reason?: string
}

/**
 * Compose and persist the default layout tree for the generated collections.
 * Returns the chosen pattern + viability so the caller can log it.
 */
export async function writeDefaultLayout(opts: WriteDefaultLayoutOptions): Promise<WriteDefaultLayoutResult> {
  const cwd = opts.cwd ?? process.cwd()
  const collections = opts.allCollections ?? []
  if (!collections.length) return { written: false, reason: 'no-collections' }

  const hasBookings = bookingsEnabled(opts.features, collections)
  const registry: CroutonLayoutBlockRegistry = {
    ...CORE_BLOCKS,
    ...(hasBookings ? BOOKINGS_BLOCKS : {}),
  }

  const composeInput: ComposeCollectionInput[] = collections.map(c => ({
    key: registryKeyFor(c.layer, c.name),
    label: toCase(c.name).pascalCasePlural,
    calendar: hasBookings && isCalendarCollection(c),
  }))

  const result = composeDefaultLayout({ collections: composeInput, registry })

  const outPath = path.resolve(cwd, opts.outFile ?? 'crouton.layout.json')
  if (opts.dryRun) {
    return { written: false, pattern: result.pattern, viable: result.viable, path: outPath, reason: 'dry-run' }
  }

  // The seed runner reads `{ id, tree }`; `pattern`/`viable` are advisory metadata.
  const payload = {
    id: 'default',
    renderer: result.tree.renderer,
    pattern: result.pattern,
    viable: result.viable,
    tree: result.tree,
  }
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { written: true, pattern: result.pattern, viable: result.viable, path: outPath }
}
