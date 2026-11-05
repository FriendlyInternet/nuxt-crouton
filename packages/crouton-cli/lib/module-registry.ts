// Module registry for `crouton add` command
// Maps short aliases to full package information
// Source of truth: crouton.manifest.ts files (via manifest-loader)

import { loadModuleRegistryMap } from './utils/manifest-loader.ts'

// Lazily loaded registry (populated on first access)
let _modules: Record<string, Record<string, any>> | null = null

/**
 * Load MODULES from manifests (async, cached).
 */
export async function loadModules(): Promise<Record<string, Record<string, any>>> {
  if (!_modules) {
    _modules = await loadModuleRegistryMap()
  }
  return _modules
}

/**
 * Get module info by alias or package name
 */
export async function getModule(name: string): Promise<Record<string, any> | undefined> {
  const modules = await loadModules()

  // Direct alias match
  if (modules[name]) {
    return modules[name]
  }

  // Search by package name
  for (const [alias, module] of Object.entries(modules)) {
    if (module.package === name) {
      return { ...module, alias }
    }
  }

  return undefined
}

/**
 * Get module alias from package name
 */
export async function getModuleAlias(packageName: string): Promise<string | undefined> {
  const modules = await loadModules()
  for (const [alias, module] of Object.entries(modules)) {
    if (module.package === packageName) {
      return alias
    }
  }
  return undefined
}

interface ModuleListEntry {
  alias: string
  package: string
  description: string
  hasSchema: boolean
  bundled: boolean
}

/**
 * List all available modules
 */
export async function listModules(): Promise<ModuleListEntry[]> {
  const modules = await loadModules()
  return Object.entries(modules).map(([alias, module]) => ({
    alias,
    package: module.package,
    description: module.description,
    hasSchema: !!module.hasSchema,
    bundled: !!module.bundled
  }))
}
