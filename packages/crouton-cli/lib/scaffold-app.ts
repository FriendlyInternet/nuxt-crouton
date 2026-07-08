// scaffold-app.ts — Generate a complete crouton app scaffold
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import consola from 'consola'
import { loadModules } from './module-registry.ts'
import { getFrameworkPackages } from './utils/framework-packages.ts'

// crouton-cli version, stamped into each scaffolded app's .crouton.json (provenance, #1233).
const CROUTON_CLI_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version
  } catch { return 'unknown' }
})()

// Wrangler helper scripts are shipped as raw templates (they're app-name-agnostic —
// they read the app's own wrangler.jsonc at runtime) and copied verbatim into the
// scaffolded app's scripts/ dir.
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates', 'wrangler')

async function readTemplate(name: string): Promise<string> {
  return readFile(join(TEMPLATE_DIR, name), 'utf-8')
}

// ─── Template helpers ─────────────────────────────────────────────

/**
 * Resolve features list against module registry, validating each one
 * and resolving transitive dependencies.
 */
function resolveFeatures(featureNames: string[], modules: Record<string, any>): string[] {
  const resolved = new Set<string>()
  const errors: string[] = []

  for (const name of featureNames) {
    const mod = modules[name]
    if (!mod) {
      errors.push(name)
      continue
    }
    // Add transitive dependencies first
    if (mod.dependencies) {
      for (const dep of mod.dependencies) {
        resolved.add(dep)
      }
    }
    resolved.add(name)
  }

  if (errors.length > 0) {
    const available = Object.keys(modules).join(', ')
    throw new Error(
      `Unknown feature(s): ${errors.join(', ')}\nAvailable: ${available}`
    )
  }

  return [...resolved]
}

/**
 * Build workspace dependencies for package.json based on resolved features.
 * Bundled modules (auth, i18n, admin) are included via @fyit/crouton-core.
 */
function buildDependencies(features: string[], modules: Record<string, any>): Record<string, string> {
  const deps: Record<string, string> = {
    '@fyit/crouton': 'workspace:*',
    '@fyit/crouton-core': 'workspace:*',
    '@fyit/crouton-i18n': 'workspace:*',
    '@libsql/client': '^0.17.0',
    'drizzle-orm': '^0.45.1',
    'nuxt': '^4.2.2',
    'vue': '^3.5.26',
    'vue-router': '^4.6.4'
  }

  for (const name of features) {
    const mod = modules[name]
    if (mod && !mod.bundled) {
      deps[mod.package] = 'workspace:*'
    }
  }

  return deps
}

/**
 * Build the features object for crouton.config.js
 * Only include non-bundled features that were explicitly requested.
 */
function buildFeaturesConfig(features: string[], modules: Record<string, any>): Record<string, boolean> {
  const config: Record<string, boolean> = {}
  for (const name of features) {
    const mod = modules[name]
    if (mod && !mod.bundled) {
      config[name] = true
    }
  }
  return config
}

// ─── Types ───────────────────────────────────────────────────────

interface ScaffoldVars {
  name: string
  features: string[]
  extends: string[]
  theme?: string
  dialect: string
  cf: boolean
  /** Optional CF zone — emits <name>.<domain> / <name>-staging.<domain> routes. */
  domain?: string
  modules: Record<string, any>
}

interface ScaffoldFile {
  path: string
  content: string
}

// ─── File templates ───────────────────────────────────────────────

function tmplPackageJson(vars: ScaffoldVars): string {
  const deps = buildDependencies(vars.features, vars.modules)
  const devDeps = {
    '@fyit/crouton-cli': 'workspace:*',
    '@fyit/crouton-devtools': 'workspace:*',
    'drizzle-kit': '^0.31.0',
    // Runs the schema-smoke tests the generator emits next to each collection
    // (#785). Not cataloged by design (#141); matches @fyit/crouton-cli.
    'vitest': '^2.1.0'
  }
  if (vars.cf) {
    devDeps['wrangler'] = '^4.64.0'
  }

  const scripts = {
    build: 'nuxt build',
    dev: 'nuxt dev',
    generate: 'nuxt generate',
    preview: 'nuxt preview',
    // Runs the per-collection schema-smoke tests the generator emits (#785).
    test: 'vitest run',
    // Guarded: a whole-monorepo `pnpm install` (e.g. on Cloudflare) runs every
    // workspace's postinstall before the dist-consumed @fyit/* packages are built;
    // a bare `nuxt prepare` would error and abort the entire install. The guard
    // always exits 0 — the real prepare still runs in each app's own pipeline.
    postinstall: 'nuxt prepare 2>/dev/null || true'
  }
  if (vars.cf) {
    // Cloudflare Workers (static assets) deploy — the crouton standard.
    // Each deploy: build → deploy (auto-provisions id-less D1/KV on first run) →
    // sync ids back into wrangler.jsonc → remote D1 migrate. See `crouton deploy`.
    scripts['cf:deploy'] = `NITRO_PRESET=cloudflare_module nuxt build && npx wrangler --cwd .output deploy && node scripts/sync-wrangler-ids.mjs && npx wrangler d1 migrations apply ${vars.name}-db --remote`
    // Staging = its OWN isolated, auto-provisioned env. The env block is dropped
    // from the generated .output config (nitro#3429), so re-inject it post-build,
    // and again after sync so the migrate command sees the provisioned ids.
    // NB: the migrate step must NOT pass --config .output/server/wrangler.json —
    // wrangler resolves migrations_dir relative to the config dir, doubling
    // `server/server/…` → "No migrations present" (#138). Drop --config so it
    // resolves from the app-root source config (where the synced ids live).
    scripts['cf:staging'] = `NUXT_PUBLIC_CROUTON_REVIEW=true NITRO_PRESET=cloudflare_module nuxt build && node scripts/inject-wrangler-env.mjs && npx wrangler deploy --config .output/server/wrangler.json --env staging && node scripts/sync-wrangler-ids.mjs && node scripts/inject-wrangler-env.mjs && npx wrangler d1 migrations apply ${vars.name}-staging-db --env staging --remote`
    scripts['sync:ids'] = 'node scripts/sync-wrangler-ids.mjs'
    scripts['db:generate'] = 'drizzle-kit generate'
    scripts['db:migrate'] = `npx wrangler d1 migrations apply ${vars.name}-db --local`
    scripts['db:migrate:prod'] = `npx wrangler d1 migrations apply ${vars.name}-db --remote`
    scripts['db:migrate:staging'] = `npx wrangler d1 migrations apply ${vars.name}-staging-db --env staging --remote`
  }

  return JSON.stringify({
    name: vars.name,
    type: 'module',
    private: true,
    version: '0.1.0',
    scripts,
    dependencies: deps,
    devDependencies: devDeps
  }, null, 2) + '\n'
}

function tmplNuxtConfig(vars: ScaffoldVars): string {
  const extendsArr = vars.extends.map(p => `    '${p}'`).join(',\n')

  // Build nitro alias block for CF stubs. The Workers preset is supplied at build
  // time via `NITRO_PRESET=cloudflare_module` (in the cf:deploy/cf:staging scripts),
  // so it's intentionally NOT pinned here — keeping `pnpm dev`/`build` preset-free.
  let nitroBlock = ''
  if (vars.cf) {
    nitroBlock = `
  // Cloudflare Workers deployment — stub passkey/webauthn packages (tsyringe is
  // incompatible with workerd). Preset comes from NITRO_PRESET at build time.
  nitro: {
    alias: {
      '@better-auth/passkey/client': resolve(cfStubs, 'client'),
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs,
      'papaparse': cfStubs
    }
  }`
  }

  // Build optional config sections
  let emailBlock = ''
  if (vars.features.includes('email')) {
    emailBlock = `\n  croutonEmail: {\n    enabled: true\n  },\n`
  }

  // CF-specific imports
  const cfImports = vars.cf
    ? `import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

`
    : ''

  return `${cfImports}// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton', '@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  extends: [
${extendsArr}
  ],
  hub: {
    db: '${vars.dialect}',
    kv: true
  },
${emailBlock}
  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },
${nitroBlock}
})
`
}

function tmplCroutonConfig(vars: ScaffoldVars): string {
  const featuresConfig = buildFeaturesConfig(vars.features, vars.modules)
  const featuresStr = Object.entries(featuresConfig)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join(',\n')

  return `export default {
  // Feature flags - which crouton packages to enable
  features: {
${featuresStr ? featuresStr + '\n' : ''}  },

  // Collections to generate (add your collections here)
  // Example:
  // collections: [
  //   { name: 'products', fieldsFile: './schemas/products.json' }
  // ],
  collections: [],

  // Target layers (add after creating collections)
  // Example:
  // targets: [
  //   { layer: 'shop', collections: ['products'] }
  // ],
  targets: [],

  dialect: '${vars.dialect}'
}
`
}

function tmplWranglerJsonc(vars: ScaffoldVars): string {
  // Workers (static-assets) config, id-LESS so the first `pnpm cf:deploy`
  // auto-provisions the D1 + KV (wrangler 4.45+). `sync-wrangler-ids.mjs` then
  // writes the provisioned ids back here (bootstrap → committed), which remote
  // `d1 migrations apply` needs (workers-sdk#13632). Same flow for env.staging.
  //
  // With --domain <zone>, custom-domain routes are emitted so `wrangler deploy`
  // auto-binds <name>.<zone> (prod) / <name>-staging.<zone> (staging), creating
  // the DNS record + cert (the zone must live in this Cloudflare account). Nitro
  // preserves top-level routes; inject-wrangler-env carries the env.staging ones.
  const prodRoute = vars.domain
    ? `\n  "routes": [{ "pattern": "${vars.name}.${vars.domain}", "custom_domain": true }],\n`
    : ''
  const stagingRoute = vars.domain
    ? `\n      "routes": [{ "pattern": "${vars.name}-staging.${vars.domain}", "custom_domain": true }],`
    : ''
  return `{
  // Cloudflare WORKERS (static assets) config for ${vars.name}.
  //
  // Nitro's \`cloudflare_module\` preset (NITRO_PRESET in cf:deploy) reads this
  // file at build time and writes the deployable config to
  // .output/server/wrangler.json, injecting \`main\` + the \`assets\` binding.
  //
  // Bootstrap → committed: bindings start id-LESS so the first deploy
  // auto-provisions them; \`pnpm sync:ids\` then writes the ids back here.
  "name": "${vars.name}",
  "compatibility_date": "2024-09-02",
  "compatibility_flags": ["nodejs_compat"],
${prodRoute}
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${vars.name}-db",
      "migrations_dir": "server/db/migrations/sqlite"
    }
  ],
  "kv_namespaces": [
    { "binding": "KV" }
  ],

  // Staging environment — its OWN isolated D1 + KV, also id-less so they
  // auto-provision on the first \`pnpm cf:staging\`. The env block is stripped
  // from the generated .output config (nitro#3429), so cf:staging re-injects it
  // via scripts/inject-wrangler-env.mjs before deploying.
  "env": {
    "staging": {${stagingRoute}
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "${vars.name}-staging-db",
          "migrations_dir": "server/db/migrations/sqlite"
        }
      ],
      "kv_namespaces": [
        { "binding": "KV" }
      ]
    }
  }
}
`
}

function tmplDrizzleConfig(): string {
  // schema path resolves whichever buildDir NuxtHub wrote the bundled schema to
  // (.nuxt for some apps, node_modules/.cache/nuxt/.nuxt when the cache buildDir
  // is used), so `pnpm db:generate` works without hand-editing the path.
  return `import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

const schemaCandidates = [
  '.nuxt/hub/db/schema.mjs',
  'node_modules/.cache/nuxt/.nuxt/hub/db/schema.mjs',
]
const schema = schemaCandidates.find(p => existsSync(p)) ?? schemaCandidates[0]

export default defineConfig({
  dialect: 'sqlite',
  schema,
  out: 'server/db/migrations/sqlite',
})
`
}

function tmplVitestConfig(): string {
  // Runs the per-collection schema-smoke tests the generator emits (#785). They
  // import only the generated Zod schema (no Nuxt runtime), so a plain node
  // environment is enough — the e2e fixture smoke owns boot + CRUD.
  return `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['layers/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
`
}

function tmplEnvExample(): string {
  return `# Authentication (required)
BETTER_AUTH_SECRET=your-secret-at-least-32-characters-long
BETTER_AUTH_URL=http://localhost:3000

# OAuth (optional)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Email (optional)
# NUXT_RESEND_API_KEY=
# NUXT_EMAIL_FROM=noreply@yourdomain.com

# AI (optional)
# NUXT_ANTHROPIC_API_KEY=
`
}

function tmplEnv(secret: string): string {
  return `# Authentication (required)
BETTER_AUTH_SECRET=${secret}
BETTER_AUTH_URL=http://localhost:3000

# OAuth (optional)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Email (optional)
# NUXT_RESEND_API_KEY=
# NUXT_EMAIL_FROM=noreply@yourdomain.com

# AI (optional)
# NUXT_ANTHROPIC_API_KEY=
`
}

function tmplGitignore(): string {
  return `# Nuxt dev/build outputs
.output
.data
.nuxt
.nitro
.cache
dist

# Node dependencies
node_modules

# Logs
logs
*.log

# Misc
.DS_Store
.fleet
.idea

# Local env files
.env
.env.*
!.env.example
.wrangler/
`
}

function tmplAppConfig(): string {
  return `import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig
  }
})
`
}

function tmplMainCss(): string {
  return `@import "tailwindcss";
@import "@nuxt/ui";

/* Scan Nuxt Crouton layers for Tailwind classes */
@source "../../../../node_modules/@fyit/crouton*/app/**/*.{vue,js,ts}";
`
}

function tmplSchemaTs(): string {
  return `// Database schema exports
// This file is auto-managed by crouton-generate

// Export auth schema from crouton-auth package (includes teamSettings)
export * from '@fyit/crouton-auth/server/database/schema/auth'
export * from './translations-ui'
`
}

function tmplTranslationsUi(vars: ScaffoldVars): string {
  if (vars.dialect === 'pg') {
    return `import { nanoid } from 'nanoid'
import { pgTable, text, boolean, timestamp, unique } from 'drizzle-orm/pg-core'

export const translationsUi = pgTable('translations_ui', {
  id: text('id').primaryKey().$default(() => nanoid()),
  userId: text('user_id').notNull(),
  teamId: text('team_id'),
  namespace: text('namespace').notNull().default('ui'),
  keyPath: text('key_path').notNull(),
  category: text('category').notNull(),
  values: text('values').$type<Record<string, string>>().notNull(),
  description: text('description'),
  isOverrideable: boolean('is_overrideable').notNull().default(true),
  createdAt: timestamp('created_at').notNull().$default(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$onUpdate(() => new Date())
}, (table) => ({
  uniqueTeamNamespaceKey: unique().on(table.teamId, table.namespace, table.keyPath)
}))

export type TranslationsUi = typeof translationsUi.$inferSelect
export type NewTranslationsUi = typeof translationsUi.$inferInsert
`
  }

  return `import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core'

export const translationsUi = sqliteTable('translations_ui', {
  id: text('id').primaryKey().$default(() => nanoid()),
  userId: text('user_id').notNull(),
  teamId: text('team_id'),
  namespace: text('namespace').notNull().default('ui'),
  keyPath: text('key_path').notNull(),
  category: text('category').notNull(),
  values: text('values', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  description: text('description'),
  isOverrideable: integer('is_overrideable', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, (table) => ({
  uniqueTeamNamespaceKey: unique().on(table.teamId, table.namespace, table.keyPath)
}))

export type TranslationsUi = typeof translationsUi.$inferSelect
export type NewTranslationsUi = typeof translationsUi.$inferInsert
`
}

function tmplCfStubsIndex(): string {
  return `// Empty stubs for Cloudflare Workers incompatible packages
// These packages are used by passkeys which are disabled for CF deployments
export default {}

// tsyringe stubs
export const container = {}
export const injectable = () => () => {}
export const inject = () => () => {}
export const singleton = () => () => {}

// @better-auth/passkey stub
export const passkey = () => ({
  id: 'passkey',
  endpoints: {},
  middlewares: [],
  hooks: {}
})

// @simplewebauthn/server stubs
export const generateRegistrationOptions = () => Promise.resolve({})
export const verifyRegistrationResponse = () => Promise.resolve({ verified: false })
export const generateAuthenticationOptions = () => Promise.resolve({})
export const verifyAuthenticationResponse = () => Promise.resolve({ verified: false })
`
}

function tmplCfStubsClient(): string {
  return `// Empty stub for Cloudflare Workers incompatible packages
export default {}
export const client = {}

// @better-auth/passkey/client stub
export const passkeyClient = () => ({
  id: 'passkey-client',
  $InferServerPlugin: {},
  getAtoms: () => ({}),
  pathMethods: {}
})
`
}

// ─── Main scaffold function ──────────────────────────────────────

export async function scaffoldApp(
  name: string,
  options: { features?: string[]; theme?: string; dialect?: string; cf?: boolean; domain?: string; dryRun?: boolean; outDir?: string } = {}
): Promise<{ files: ScaffoldFile[]; appDir: string }> {
  const {
    features: featureNames = [],
    theme,
    dialect = 'sqlite',
    cf = true,
    domain,
    dryRun = false,
    outDir
  } = options

  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Invalid app name "${name}". Use lowercase letters, numbers, and hyphens.`)
  }

  // Load module registry from manifests
  const modules = await loadModules()

  // Resolve features and their dependencies
  const features = resolveFeatures(featureNames, modules)

  // Build extends array via framework-packages.ts
  const featuresConfig: Record<string, boolean> = {}
  for (const f of features) {
    featuresConfig[f] = true
  }
  const frameworkPackages = getFrameworkPackages(featuresConfig)

  // Add theme to extends if specified
  if (theme) {
    frameworkPackages.push(`@fyit/crouton-themes/${theme}`)
  }

  // Add i18n to extends (it's bundled but bike-sheds adds it explicitly for i18n features)
  // Actually, framework-packages.ts doesn't add bundled packages, which is correct.
  // But bike-sheds adds @fyit/crouton-i18n explicitly. Let's match that pattern
  // since i18n is always needed for translations-ui.
  if (!frameworkPackages.includes('@fyit/crouton-i18n')) {
    // Insert after crouton-core
    const coreIdx = frameworkPackages.indexOf('@fyit/crouton-core')
    frameworkPackages.splice(coreIdx + 1, 0, '@fyit/crouton-i18n')
  }

  const vars: ScaffoldVars = { name, features, extends: frameworkPackages, theme, dialect, cf, domain, modules }
  const authSecret = randomBytes(32).toString('hex')

  // Build file list
  const files: ScaffoldFile[] = [
    { path: 'package.json', content: tmplPackageJson(vars) },
    { path: 'nuxt.config.ts', content: tmplNuxtConfig(vars) },
    { path: 'crouton.config.js', content: tmplCroutonConfig(vars) },
    // Identifier + provenance (#1233): marks the dir as a scaffolded crouton app (the guard reads
    // it to distinguish "already scaffolded" from a config-only dir) and records how it was made.
    { path: '.crouton.json', content: JSON.stringify({
      crouton: true,
      name,
      kind: (outDir || '').startsWith('pocs/') ? 'poc' : 'app',
      cliVersion: CROUTON_CLI_VERSION,
      scaffoldedAt: new Date().toISOString(),
    }, null, 2) + '\n' },
    { path: '.env', content: tmplEnv(authSecret) },
    { path: '.env.example', content: tmplEnvExample() },
    { path: '.gitignore', content: tmplGitignore() },
    { path: 'app/app.config.ts', content: tmplAppConfig() },
    { path: 'app/assets/css/main.css', content: tmplMainCss() },
    { path: 'server/db/schema.ts', content: tmplSchemaTs() },
    { path: 'server/db/translations-ui.ts', content: tmplTranslationsUi(vars) },
    { path: 'vitest.config.ts', content: tmplVitestConfig() },
    { path: 'schemas/.gitkeep', content: '' }
  ]

  // Add Cloudflare-specific files
  if (cf) {
    const [injectScript, syncScript] = await Promise.all([
      readTemplate('inject-wrangler-env.mjs'),
      readTemplate('sync-wrangler-ids.mjs'),
    ])
    files.push(
      { path: 'wrangler.jsonc', content: tmplWranglerJsonc(vars) },
      { path: 'drizzle.config.ts', content: tmplDrizzleConfig() },
      { path: 'scripts/inject-wrangler-env.mjs', content: injectScript },
      { path: 'scripts/sync-wrangler-ids.mjs', content: syncScript },
      { path: 'server/utils/_cf-stubs/index.ts', content: tmplCfStubsIndex() },
      { path: 'server/utils/_cf-stubs/client.ts', content: tmplCfStubsClient() }
    )
  }

  const appDir = outDir || join('apps', name)

  // Dry run — just print what would be created
  if (dryRun) {
    consola.info(`\n  Scaffold preview for ${name}\n`)
    console.log(`  Directory: ${appDir}/\n`)
    console.log('  Features:', features.length > 0 ? features.join(', ') : '(none)')
    console.log('  Extends:', frameworkPackages.join(', '))
    console.log('  Dialect:', dialect)
    console.log('  Cloudflare:', cf ? 'yes' : 'no')
    if (theme) console.log('  Theme:', theme)
    console.log()
    for (const file of files) {
      console.log('  + ' + file.path)
    }
    console.log(`\n  ${files.length} files would be created.\n`)
    return { files, appDir }
  }

  // Refuse a dir that's ALREADY a scaffolded crouton app (`.crouton.json`) or some other project
  // (`package.json`) — but ALLOW scaffolding INTO a config-only dir, e.g. the schema-sign-off step
  // already wrote `crouton.config.js` (#1233). That's what makes the schema-first pipeline a single
  // `crouton init` command instead of a 100-turn improvised workaround.
  const exists = (f: string) => access(join(appDir, f)).then(() => true).catch(() => false)
  if (await exists('.crouton.json')) {
    throw new Error(`"${appDir}" is already a scaffolded crouton app (.crouton.json present). Remove it or choose a different name.`)
  }
  if (await exists('package.json')) {
    throw new Error(`"${appDir}" already exists and looks like a project (has package.json). Remove it or choose a different name.`)
  }
  const hadConfig = await exists('crouton.config.js')

  // Write all files (preserving an already-present crouton.config.js — the reviewed schema).
  consola.info(`\n  Scaffolding ${name}${hadConfig ? ' (into existing config-only dir)' : ''}...\n`)

  for (const file of files) {
    const filePath = join(appDir, file.path)
    if (file.path === 'crouton.config.js' && hadConfig) {
      consola.info('  • crouton.config.js exists — preserving the reviewed config')
      continue
    }
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, file.content)
    consola.success('  + ' + file.path)
  }

  // Print next steps
  consola.info(`\n  Done! ${files.length} files created in ${appDir}/\n`)
  consola.warn('  Next steps:\n')
  console.log('  1.', `cd ${appDir}`)
  console.log('  2.', 'pnpm install')
  console.log('  3.', 'Add your schemas to schemas/ directory')
  console.log('  4.', 'Update crouton.config.js with collections')
  console.log('  5.', 'crouton generate')
  if (cf) {
    console.log('  6.', 'pnpm cf:deploy    (builds, auto-provisions D1+KV, syncs ids, migrates, deploys to Workers)')
    console.log('  7.', 'pnpm cf:staging   (deploys an isolated, auto-provisioned staging env)')
  }
  console.log()

  return { files, appDir }
}
