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
    if (def.id.startsWith('__')) continue
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
