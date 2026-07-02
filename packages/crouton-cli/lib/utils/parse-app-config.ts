// parse-app-config.ts — Extract deployment-relevant info from an app directory
// Used by deploy-check to understand what an app needs

import { join } from 'node:path'
import { readFile, access } from 'node:fs/promises'
import { parseModule } from 'magicast'

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export interface AppConfig {
  name: string
  extends: string[]
  hub: { db?: string; kv?: boolean; blob?: boolean }
  hasPasskeysDisabled: boolean
  hasOgImageDisabled: boolean
  hasHardcodedPreset: boolean
  hasCfStubs: boolean
  wranglerFormat: 'toml' | 'jsonc' | 'json' | null
  wrangler: WranglerConfig | null
  ciWorkflowPath: string | null
}

export interface WranglerConfig {
  name?: string
  d1Databases: Array<{ binding: string; databaseName: string; databaseId: string }>
  kvNamespaces: Array<{ binding: string; id: string }>
  r2Buckets: Array<{ binding: string; bucketName: string }>
  hasEnvBlock: boolean
}

/**
 * Parse nuxt.config.ts to extract extends array and hub config
 */
async function parseNuxtConfig(appDir: string): Promise<{
  extends: string[]
  hub: { db?: string; kv?: boolean; blob?: boolean }
  hasHardcodedPreset: boolean
}> {
  const configPath = join(appDir, 'nuxt.config.ts')
  if (!await pathExists(configPath)) {
    return { extends: [], hub: {}, hasHardcodedPreset: false }
  }

  const code = await readFile(configPath, 'utf-8')

  // Use magicast for structured parsing
  try {
    const mod = parseModule(code)
    const defaultExport = mod.exports.default
    const options = defaultExport.$type === 'function-call'
      ? defaultExport.$args[0]
      : defaultExport

    const extendsArr: string[] = []
    if (options.extends) {
      for (let i = 0; i < options.extends.length; i++) {
        extendsArr.push(String(options.extends[i]))
      }
    }

    const hub: { db?: string; kv?: boolean; blob?: boolean } = {}
    if (options.hub) {
      if (options.hub.db) hub.db = String(options.hub.db)
      if (options.hub.kv) hub.kv = true
      if (options.hub.blob) hub.blob = true
      // Check for the deprecated database: true pattern
      if (options.hub.database) hub.db = 'database:true'
    }

    const hasHardcodedPreset = !!(options.nitro?.preset)

    return { extends: extendsArr, hub, hasHardcodedPreset }
  } catch {
    // Fallback to regex for complex configs magicast can't handle
    const extendsMatch = code.match(/extends\s*:\s*\[([\s\S]*?)\]/m)
    const extendsArr: string[] = []
    if (extendsMatch) {
      const entries = extendsMatch[1].matchAll(/['"]([^'"]+)['"]/g)
      for (const m of entries) {
        extendsArr.push(m[1])
      }
    }

    const hubDb = code.match(/db\s*:\s*['"](\w+)['"]/)
    const hasKv = /kv\s*:\s*true/.test(code)
    const hasBlob = /blob\s*:\s*true/.test(code)
    const hasDatabase = /database\s*:\s*true/.test(code)
    const hasHardcodedPreset = /preset\s*:\s*['"]cloudflare/.test(code)

    return {
      extends: extendsArr,
      hub: {
        db: hasDatabase ? 'database:true' : hubDb?.[1],
        kv: hasKv,
        blob: hasBlob,
      },
      hasHardcodedPreset,
    }
  }
}

/**
 * Parse wrangler config (toml or jsonc)
 */
async function parseWranglerConfig(appDir: string): Promise<{ format: 'toml' | 'jsonc' | 'json' | null; config: WranglerConfig | null }> {
  // Try formats in order of preference
  for (const format of ['jsonc', 'json', 'toml'] as const) {
    const filePath = join(appDir, `wrangler.${format}`)
    if (!await pathExists(filePath)) continue

    const content = await readFile(filePath, 'utf-8')

    if (format === 'toml') {
      return { format, config: parseWranglerToml(content) }
    } else {
      return { format, config: parseWranglerJson(content) }
    }
  }

  return { format: null, config: null }
}

function parseWranglerToml(content: string): WranglerConfig {
  const d1Databases: WranglerConfig['d1Databases'] = []
  const kvNamespaces: WranglerConfig['kvNamespaces'] = []
  const r2Buckets: WranglerConfig['r2Buckets'] = []

  // Parse name
  const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m)

  // Parse D1 databases
  const d1Regex = /\[\[d1_databases\]\]([\s\S]*?)(?=\[\[|$)/g
  for (const match of content.matchAll(d1Regex)) {
    const block = match[1]
    const binding = block.match(/binding\s*=\s*"([^"]+)"/)?.[1] || ''
    const dbName = block.match(/database_name\s*=\s*"([^"]+)"/)?.[1] || ''
    const dbId = block.match(/database_id\s*=\s*"([^"]+)"/)?.[1] || ''
    d1Databases.push({ binding, databaseName: dbName, databaseId: dbId })
  }

  // Parse KV namespaces
  const kvRegex = /\[\[kv_namespaces\]\]([\s\S]*?)(?=\[\[|$)/g
  for (const match of content.matchAll(kvRegex)) {
    const block = match[1]
    const binding = block.match(/binding\s*=\s*"([^"]+)"/)?.[1] || ''
    const id = block.match(/id\s*=\s*"([^"]+)"/)?.[1] || ''
    kvNamespaces.push({ binding, id })
  }

  // Parse R2 buckets
  const r2Regex = /\[\[r2_buckets\]\]([\s\S]*?)(?=\[\[|$)/g
  for (const match of content.matchAll(r2Regex)) {
    const block = match[1]
    const binding = block.match(/binding\s*=\s*"([^"]+)"/)?.[1] || ''
    const bucketName = block.match(/bucket_name\s*=\s*"([^"]+)"/)?.[1] || ''
    r2Buckets.push({ binding, bucketName })
  }

  const hasEnvBlock = /^\[env\./m.test(content) || /^\[env\]/m.test(content)

  return {
    name: nameMatch?.[1],
    d1Databases,
    kvNamespaces,
    r2Buckets,
    hasEnvBlock,
  }
}

function parseWranglerJson(content: string): WranglerConfig {
  // Strip JSONC comments
  const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  try {
    const parsed = JSON.parse(stripped)

    const d1Databases = (parsed.d1_databases || []).map((db: any) => ({
      binding: db.binding,
      databaseName: db.database_name,
      databaseId: db.database_id,
    }))

    const kvNamespaces = (parsed.kv_namespaces || []).map((kv: any) => ({
      binding: kv.binding,
      id: kv.id,
    }))

    const r2Buckets = (parsed.r2_buckets || []).map((r2: any) => ({
      binding: r2.binding,
      bucketName: r2.bucket_name,
    }))

    return {
      name: parsed.name,
      d1Databases,
      kvNamespaces,
      r2Buckets,
      hasEnvBlock: !!parsed.env,
    }
  } catch {
    return { d1Databases: [], kvNamespaces: [], r2Buckets: [], hasEnvBlock: false }
  }
}

/**
 * Find CI workflow file for this app
 */
async function findCiWorkflow(appDir: string, appName: string): Promise<string | null> {
  // Walk up to find .github/workflows
  let dir = appDir
  for (let i = 0; i < 5; i++) {
    const workflowDir = join(dir, '.github', 'workflows')
    if (await pathExists(workflowDir)) {
      // Look for deploy-{name}.yml
      const candidates = [`deploy-${appName}.yml`, `deploy-${appName}.yaml`]
      for (const name of candidates) {
        const fullPath = join(workflowDir, name)
        if (await pathExists(fullPath)) {
          return fullPath
        }
      }
      return null
    }
    dir = join(dir, '..')
  }
  return null
}

/**
 * Check which extended packages have a build script
 */
export async function getPackagesNeedingBuild(extendsArr: string[], monorepoRoot: string): Promise<string[]> {
  const needsBuild: string[] = []

  for (const pkg of extendsArr) {
    // Skip local layers (start with ./)
    if (pkg.startsWith('./') || pkg.startsWith('../')) continue

    // Map package name to directory
    const dirName = pkg.replace('@fyit/', '')
    const pkgJsonPath = join(monorepoRoot, 'packages', dirName, 'package.json')

    if (!await pathExists(pkgJsonPath)) continue

    try {
      const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
      if (pkgJson.scripts?.build) {
        needsBuild.push(pkg)
      }
    } catch {
      // skip
    }
  }

  return needsBuild
}

/**
 * Find the monorepo root by looking for pnpm-workspace.yaml
 */
export async function findMonorepoRoot(startDir: string): Promise<string | null> {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (await pathExists(join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Gather all deployment-relevant config from an app directory
 */
export async function parseAppConfig(appDir: string): Promise<AppConfig> {
  // Parse package.json for app name
  let name = 'app'
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf-8'))
    name = pkg.name || 'app'
  } catch { /* ignore */ }

  // Parse nuxt config
  const nuxtConfig = await parseNuxtConfig(appDir)

  // Parse wrangler config
  const { format: wranglerFormat, config: wrangler } = await parseWranglerConfig(appDir)

  // Check for CF stubs
  const hasCfStubs = await pathExists(join(appDir, 'server', 'utils', '_cf-stubs', 'index.ts'))
    && await pathExists(join(appDir, 'server', 'utils', '_cf-stubs', 'client.ts'))

  // Check nuxt config for passkeys/ogImage via string search (simpler than AST for boolean checks)
  const configContent = await pathExists(join(appDir, 'nuxt.config.ts'))
    ? await readFile(join(appDir, 'nuxt.config.ts'), 'utf-8')
    : ''
  const hasPasskeysDisabled = /passkeys\s*:\s*false/.test(configContent)
  const hasOgImageDisabled = /ogImage\s*:\s*\{\s*enabled\s*:\s*false\s*\}/.test(configContent)

  // Find CI workflow
  const ciWorkflowPath = await findCiWorkflow(appDir, name)

  return {
    name,
    extends: nuxtConfig.extends,
    hub: nuxtConfig.hub,
    hasPasskeysDisabled,
    hasOgImageDisabled,
    hasHardcodedPreset: nuxtConfig.hasHardcodedPreset,
    hasCfStubs,
    wranglerFormat,
    wrangler,
    ciWorkflowPath,
  }
}
