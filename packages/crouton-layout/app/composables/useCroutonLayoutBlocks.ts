import { computed } from 'vue'
import type {
  CroutonLayoutBlockDefinition,
  CroutonLayoutBlockRegistry,
} from '@fyit/crouton-core/app/types/layout-block'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import {
  checkTreeViability,
  minWidthResolver,
  type ViabilityResult,
} from '../utils/layout-viability'
import {
  composeDefaultLayout,
  type ComposeCollectionInput,
  type ComposeDefaultLayoutOptions,
  type ComposeResult,
} from '../utils/layout-compose'

/**
 * Layout block registry reader (Sprint 1, #704).
 *
 * Reads `app.config.croutonLayoutBlocks` (deep-merged across all extending
 * layers by Nuxt/defu), so any package can declare placeable blocks the same way
 * it declares `croutonApps` / page types. Resolution is ALLOWLISTED: a block id
 * resolves only to a component NAME a package actually registered — a hostile or
 * unknown id (e.g. from a tampered persisted layout tree) resolves to null and
 * the renderer shows a safe fallback, never an arbitrary component.
 *
 * The pure helpers below are exported separately so they can be unit-tested
 * without a Nuxt runtime.
 */

/** Allowlisted resolution: a block id → its registered component NAME, or null. */
export function resolveLayoutBlockComponentName(
  registry: CroutonLayoutBlockRegistry,
  id: string,
): string | null {
  return registry[id]?.component ?? null
}

/**
 * Validate persisted per-block config against the block's declared schema.
 * Keeps ONLY declared fields whose value matches the declared primitive type;
 * everything else is dropped (unknown keys, wrong types, prototype pollution).
 * A declared field with a wrong/missing value falls back to its `default`.
 */
export function sanitizeLayoutBlockConfig(
  def: CroutonLayoutBlockDefinition | undefined,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!def?.configSchema?.length) return {}
  const out: Record<string, unknown> = {}
  for (const field of def.configSchema) {
    const value = config?.[field.name]
    const ok
      = (field.type === 'number' && typeof value === 'number')
        || (field.type === 'boolean' && typeof value === 'boolean')
        || ((field.type === 'text' || field.type === 'select') && typeof value === 'string')
    if (ok) out[field.name] = value
    else if (field.default !== undefined) out[field.name] = field.default
  }
  return out
}

export function useCroutonLayoutBlocks() {
  // AppConfig is augmented loosely across layers; cast to the slice we own.
  const appConfig = useAppConfig() as { croutonLayoutBlocks?: CroutonLayoutBlockRegistry }

  const blocks = computed<CroutonLayoutBlockRegistry>(
    () => appConfig.croutonLayoutBlocks || {},
  )
  const blocksList = computed<CroutonLayoutBlockDefinition[]>(
    () => Object.values(blocks.value),
  )

  function getBlock(id: string): CroutonLayoutBlockDefinition | undefined {
    return blocks.value[id]
  }
  function hasBlock(id: string): boolean {
    return id in blocks.value
  }
  function resolveComponentName(id: string): string | null {
    return resolveLayoutBlockComponentName(blocks.value, id)
  }
  function sanitizeConfig(id: string, config?: Record<string, unknown>): Record<string, unknown> {
    return sanitizeLayoutBlockConfig(blocks.value[id], config)
  }
  /**
   * Viability check (#710) bound to the live registry — a layout is viable iff
   * every placed block meets its declared `minWidth` at the given container
   * width(s). Used by the renderer (#706) and the deterministic layout (#709).
   */
  function checkViability(tree: LayoutTree, targetWidths: number[]): ViabilityResult {
    return checkTreeViability(tree, minWidthResolver(blocks.value), targetWidths)
  }
  /**
   * Deterministic default layout (#709) bound to the live registry — arrange the
   * given collections into a viable default tree. Same pure rule set the CLI runs
   * at generate time; here it reads the live `croutonLayoutBlocks`.
   */
  function composeDefault(
    collections: ComposeCollectionInput[],
    opts?: Omit<ComposeDefaultLayoutOptions, 'collections' | 'registry'>,
  ): ComposeResult {
    return composeDefaultLayout({ collections, registry: blocks.value, ...opts })
  }

  return { blocks, blocksList, getBlock, hasBlock, resolveComponentName, sanitizeConfig, checkViability, composeDefault }
}
