/**
 * The pages handler opt-in (#3982). Pure, so the decision is testable without
 * booting Nuxt; `module.ts` feeds it the app's layer package names.
 *
 * The handler lives in `server/mcp-pages/` — outside the `server/mcp/` folder the
 * MCP toolkit scans in every layer — so it loads ONLY when the app sets
 * `croutonMcpToolkit.pages: true`, and only when the packages it imports are there.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Handler folder, RELATIVE to a layer's `server/`. The toolkit resolves handler
 * paths against every layer's `server/` and dedupes per layer, so a relative path
 * exists only in this layer (an absolute one would register `pages` once per layer).
 */
export const PAGES_MCP_DIR = 'mcp-pages'

const PAGES_REQUIRED_PACKAGES = ['@fyit/crouton-pages', '@fyit/crouton-collab'] as const

export interface PagesHandlerDecision {
  enabled: boolean
}

/**
 * `pages` not `true` → off. `pages: true` with crouton-pages AND crouton-collab
 * extended → on. `pages: true` with either missing → throws (fail the build
 * loudly rather than serve tools that cannot work).
 */
export function resolvePagesHandler({ pages, layerPackages }: { pages?: boolean, layerPackages: string[] }): PagesHandlerDecision {
  if (pages !== true) return { enabled: false }
  const missing = PAGES_REQUIRED_PACKAGES.filter(name => !layerPackages.includes(name))
  if (missing.length > 0) {
    throw new Error(`croutonMcpToolkit.pages needs @fyit/crouton-pages and @fyit/crouton-collab (missing: ${missing.join(', ')})`)
  }
  return { enabled: true }
}

export interface ToolkitSetupPlan {
  /** Install the MCP toolkit at all. */
  enabled: boolean
  /** Serve the generic tools at /mcp (false → the 404 gate is registered). */
  genericTools: boolean
  /** Serve the pages handler at /mcp/pages. */
  pages: boolean
}

/**
 * What module.ts should set up. `enabled` defaults to dev-only; the pages check
 * (and the layer scan behind `layerPackages`) only runs when the toolkit is on.
 */
export function resolveToolkitSetup(
  config: { enabled?: boolean, genericTools?: boolean, pages?: boolean },
  dev: boolean,
  layerPackages: () => string[]
): ToolkitSetupPlan {
  const enabled = config.enabled ?? dev
  if (!enabled) return { enabled: false, genericTools: false, pages: false }
  const { enabled: pages } = resolvePagesHandler({ pages: config.pages, layerPackages: layerPackages() })
  return { enabled: true, genericTools: config.genericTools !== false, pages }
}

/** The `name` of each layer root's package.json; roots without a readable one are skipped. */
export function layerPackageNames(roots: string[]): string[] {
  const names: string[] = []
  for (const root of roots) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown }
      if (typeof pkg.name === 'string' && pkg.name) names.push(pkg.name)
    } catch {
      // No package.json (e.g. the app's own root without one) — not a package layer
    }
  }
  return names
}
