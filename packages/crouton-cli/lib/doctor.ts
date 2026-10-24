// doctor.ts — Validate an existing crouton app directory
import { join, resolve } from 'node:path'
import { access, readFile } from 'node:fs/promises'
import consola from 'consola'
import { loadModules } from './module-registry.ts'
import { resolveExtendedPackages, packageAlias } from './utils/extended-packages.ts'

interface DoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

interface DoctorResult {
  ok: boolean
  checks: DoctorCheck[]
}

/**
 * Run all doctor checks against an app directory.
 */
export async function doctor(appDir: string): Promise<DoctorResult> {
  const checks: DoctorCheck[] = []

  // Ensure the directory exists
  if (!await pathExists(appDir)) {
    return { ok: false, checks: [{ name: 'directory', status: 'fail', message: `Directory not found: ${appDir}` }] }
  }

  // Load crouton.config if it exists
  const config = await loadConfig(appDir)

  // Load package.json
  const pkg = await loadJson(join(appDir, 'package.json'))

  // 1. Missing dependencies vs the packages nuxt.config.ts extends (#2286)
  checks.push(...await checkFeatureDeps(appDir, config, pkg))

  // 2. Stale wrangler.toml placeholder IDs
  checks.push(...await checkWranglerIds(appDir))

  // 3. Missing locale files
  checks.push(...await checkLocaleFiles(appDir, config))

  // 4. Missing CF stubs
  checks.push(...await checkCfStubs(appDir))

  // 5. Schema.ts exports
  checks.push(...await checkSchemaExports(appDir))

  const ok = checks.every(c => c.status !== 'fail')
  return { ok, checks }
}

// ─── Helpers ──────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function loadJson(filePath: string): Promise<Record<string, any> | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function loadConfig(appDir: string): Promise<Record<string, any> | null> {
  const extensions = ['.js', '.mjs', '.cjs']
  for (const ext of extensions) {
    const configPath = resolve(appDir, `crouton.config${ext}`)
    if (await pathExists(configPath)) {
      try {
        const mod = await import(`file://${configPath}`)
        return mod.default || mod
      } catch {
        return null
      }
    }
  }
  return null
}

// ─── Check 1: Feature dependencies ───────────────────────────────

async function checkFeatureDeps(appDir: string, config: Record<string, any> | null, pkg: Record<string, any> | null): Promise<DoctorCheck[]> {
  const results: DoctorCheck[] = []

  if (!config) {
    results.push({ name: 'config', status: 'warn', message: 'No crouton.config found — skipping feature dependency check' })
    return results
  }
  if (!pkg) {
    results.push({ name: 'package.json', status: 'fail', message: 'No package.json found' })
    return results
  }

  const MODULES = await loadModules()
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  // The packages the app extends are the ones that must be installed (#2286).
  for (const id of resolveExtendedPackages(appDir)) {
    const mod = MODULES[packageAlias(id)]
    if (!mod) continue
    if (mod.bundled) continue // bundled in @fyit/crouton-core

    const hasPkg = mod.package in allDeps
    if (!hasPkg) {
      results.push({
        name: 'deps',
        status: 'fail',
        message: `nuxt.config.ts extends ${mod.package} but it is not in dependencies`
      })
    }
  }

  // Check flags that imply dependencies
  if (config.flags?.useMaps) {
    const hasMaps = '@fyit/crouton-maps' in allDeps
    if (!hasMaps) {
      results.push({ name: 'deps', status: 'fail', message: 'Flag useMaps enabled but @fyit/crouton-maps not in dependencies' })
    }
  }

  if (results.length === 0) {
    results.push({ name: 'deps', status: 'pass', message: 'All feature dependencies present' })
  }

  return results
}

// ─── Check 2: Wrangler placeholder IDs ───────────────────────────

async function checkWranglerIds(appDir: string): Promise<DoctorCheck[]> {
  const results: DoctorCheck[] = []
  const wranglerPath = join(appDir, 'wrangler.toml')

  if (!await pathExists(wranglerPath)) {
    // No wrangler.toml is fine (--no-cf apps)
    return results
  }

  const content = await readFile(wranglerPath, 'utf-8')

  if (content.includes('TODO_REPLACE_WITH_REAL_ID')) {
    const count = (content.match(/TODO_REPLACE_WITH_REAL_ID/g) || []).length
    results.push({
      name: 'wrangler',
      status: 'warn',
      message: `wrangler.toml has ${count} placeholder ID(s) — replace before deploying`
    })
  } else {
    results.push({ name: 'wrangler', status: 'pass', message: 'wrangler.toml IDs configured' })
  }

  return results
}

// ─── Check 3: Missing locale files ───────────────────────────────

async function checkLocaleFiles(appDir: string, config: Record<string, any> | null): Promise<DoctorCheck[]> {
  const results: DoctorCheck[] = []
  const targets = config?.targets || []

  for (const target of targets) {
    const layerDir = join(appDir, 'layers', target.layer)
    if (!await pathExists(layerDir)) continue

    // Check for i18n/locales directory
    const localesDir = join(layerDir, 'i18n', 'locales')
    if (!await pathExists(localesDir)) {
      results.push({
        name: 'locales',
        status: 'warn',
        message: `Layer "${target.layer}" missing i18n/locales/ directory`
      })
    }
  }

  if (results.length === 0 && targets.length > 0) {
    results.push({ name: 'locales', status: 'pass', message: 'Locale directories present' })
  }

  return results
}

// ─── Check 4: CF stubs ───────────────────────────────────────────

async function checkCfStubs(appDir: string): Promise<DoctorCheck[]> {
  const results: DoctorCheck[] = []
  const nuxtConfigPath = join(appDir, 'nuxt.config.ts')

  if (!await pathExists(nuxtConfigPath)) return results

  const content = await readFile(nuxtConfigPath, 'utf-8')

  // Only check stubs if Cloudflare preset is configured
  if (!content.includes('cloudflare-pages')) return results

  const stubsDir = join(appDir, 'server', 'utils', '_cf-stubs')
  const indexStub = join(stubsDir, 'index.ts')
  const clientStub = join(stubsDir, 'client.ts')

  const missing = []
  if (!await pathExists(indexStub)) missing.push('index.ts')
  if (!await pathExists(clientStub)) missing.push('client.ts')

  if (missing.length > 0) {
    results.push({
      name: 'cf-stubs',
      status: 'fail',
      message: `CF stubs missing: ${missing.join(', ')} — required for Cloudflare deployment`
    })
  } else {
    results.push({ name: 'cf-stubs', status: 'pass', message: 'CF stubs present' })
  }

  return results
}

// ─── Check 5: Schema exports ─────────────────────────────────────

async function checkSchemaExports(appDir: string): Promise<DoctorCheck[]> {
  const results: DoctorCheck[] = []
  const schemaPath = join(appDir, 'server', 'db', 'schema.ts')

  if (!await pathExists(schemaPath)) {
    results.push({ name: 'schema', status: 'fail', message: 'server/db/schema.ts not found' })
    return results
  }

  const content = await readFile(schemaPath, 'utf-8')

  // Check for auth schema export
  if (!content.includes('crouton-auth/server/database/schema/auth')) {
    results.push({ name: 'schema', status: 'warn', message: 'schema.ts missing auth schema export' })
  }

  // Check for translations-ui export
  if (!content.includes('translations-ui')) {
    results.push({ name: 'schema', status: 'warn', message: 'schema.ts missing translations-ui export' })
  }

  if (results.length === 0) {
    results.push({ name: 'schema', status: 'pass', message: 'schema.ts exports look good' })
  }

  return results
}

// ─── Reporter ─────────────────────────────────────────────────────

export function printReport(result: DoctorResult): void {
  const icons = { pass: '✓', warn: '⚠', fail: '✗' }

  console.log('\n  Crouton Doctor\n')

  for (const check of result.checks) {
    if (check.status === 'pass') {
      consola.success(`${check.message}`)
    } else if (check.status === 'warn') {
      consola.warn(`${check.message}`)
    } else {
      consola.error(`${check.message}`)
    }
  }

  const fails = result.checks.filter(c => c.status === 'fail').length
  const warns = result.checks.filter(c => c.status === 'warn').length

  console.log()
  if (fails > 0) {
    consola.error(`${fails} issue(s) found.`)
  } else if (warns > 0) {
    consola.warn(`${warns} warning(s), no critical issues.`)
  } else {
    consola.success('All checks passed!')
  }
  console.log()
}
