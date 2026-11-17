/**
 * Palette groups (#3748) — Builder's block row, one chip per collection + Layout.
 *
 * The flat row of every registered block scrolled sideways and offered the
 * generic List / Form / Stats blocks, which Builder can't link to a collection
 * ("Configure a collection to show its form"). The row is grouped instead:
 *  · a block named `<Group> · <Item>` (e.g. `Artists · Form`) joins `<Group>`;
 *    its collection is the `collection` config default when it has one;
 *  · a `chrome` block (Top bar, Bottom nav, Spacer) joins **Layout**;
 *  · anything else — the unlinked generic blocks, internal `__…__` blocks — is
 *    left out of the row. They stay registered, so pages that use them render.
 * The rule is checked per BLOCK, not per group: a block that declares a
 * `collection` field but leaves it empty would show "Configure a collection",
 * so it is never offered, even when it's named into a group (`offerable`).
 * Collections sort alphabetically, Layout last; a group's icon is its first block's.
 */
import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'

export interface PaletteItem { blockId: string, label: string, icon: string }
export interface PaletteGroup {
  key: string
  label: string
  icon: string
  /** The collection the group's blocks bind to, when one declares it. */
  collection: string | null
  items: PaletteItem[]
}

export const LAYOUT_GROUP = 'Layout'
const SEP = ' · '
const FALLBACK_ICON = 'i-lucide-box'

function collectionOf(def: CroutonLayoutBlockDefinition): string | null {
  const field = def.configSchema?.find(f => f.name === 'collection')
  const fromField = typeof field?.default === 'string' ? field.default : ''
  const fromConfig = typeof def.defaultConfig?.collection === 'string' ? def.defaultConfig.collection : ''
  return fromField || fromConfig || null
}

/**
 * True when Builder's row may offer this block: a layout piece, a block linked to
 * a collection, or a self-contained block that has no `collection` field at all
 * (e.g. Artists · Stats). A block that needs a collection but has none is not.
 */
export function offerable(def: CroutonLayoutBlockDefinition): boolean {
  if (def.id.startsWith('__')) return false
  if (def.category === 'chrome') return true
  const needsCollection = !!def.configSchema?.some(f => f.name === 'collection')
    || (def.defaultConfig != null && 'collection' in def.defaultConfig)
  return !needsCollection || !!collectionOf(def)
}

export function groupPaletteBlocks(list: CroutonLayoutBlockDefinition[]): PaletteGroup[] {
  const groups = new Map<string, PaletteGroup>()
  const add = (key: string, label: string, collection: string | null, def: CroutonLayoutBlockDefinition, itemLabel: string) => {
    const icon = def.icon ?? FALLBACK_ICON
    let g = groups.get(key)
    if (!g) {
      g = { key, label, icon, collection, items: [] }
      groups.set(key, g)
    }
    if (!g.collection && collection) g.collection = collection
    g.items.push({ blockId: def.id, label: itemLabel, icon })
  }

  for (const def of list) {
    if (!offerable(def)) continue
    const at = def.name.indexOf(SEP)
    if (at > 0) {
      const label = def.name.slice(0, at).trim()
      add(label, label, collectionOf(def), def, def.name.slice(at + SEP.length).trim())
    }
    else if (def.category === 'chrome') {
      add(LAYOUT_GROUP, LAYOUT_GROUP, null, def, def.name)
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === LAYOUT_GROUP) return 1
    if (b.key === LAYOUT_GROUP) return -1
    return a.label.localeCompare(b.label)
  })
}
