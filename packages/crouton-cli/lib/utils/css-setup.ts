// css-setup.ts - Setup Tailwind CSS @source directive for Nuxt Crouton layers
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileExists } from '@fyit/crouton-core/shared/utils/fs'
import { addToConfigArray } from './update-nuxt-config.ts'

interface CssFile {
  path: string
  relativePath: string
}

interface SetupResult {
  success: boolean
  action?: 'already_configured' | 'updated' | 'created'
  file?: string
  error?: string
}

interface SetupOptions {
  silent?: boolean
  force?: boolean
}

/**
 * Common CSS file locations to check (in order of preference)
 */
const CSS_FILE_LOCATIONS = [
  'app/assets/css/main.css',
  'app/assets/css/tailwind.css',
  'app/assets/css/app.css',
  'assets/css/main.css',
  'assets/css/tailwind.css',
  'app.css',
  'main.css',
]

/**
 * Find the main CSS file in the project
 */
async function findMainCssFile(projectRoot = process.cwd()): Promise<CssFile | null> {
  for (const location of CSS_FILE_LOCATIONS) {
    const fullPath = path.join(projectRoot, location)
    if (await fileExists(fullPath)) {
      return { path: fullPath, relativePath: location }
    }
  }
  return null
}

/**
 * Calculate the correct relative path to node_modules based on CSS file depth
 */
function calculateNodeModulesPath(cssRelativePath: string): string {
  // Count directory depth from project root
  const depth = cssRelativePath.split('/').length - 1
  const upDirs = '../'.repeat(depth + 1) // +1 to get out of the css file's directory
  return `${upDirs}node_modules/@fyit/crouton*/app/**/*.{vue,js,ts}`
}

/**
 * Check if the CSS file already has the @source directive for Nuxt Crouton
 */
async function hasSourceDirective(cssPath: string): Promise<boolean> {
  try {
    const content = await fsp.readFile(cssPath, 'utf-8')
    return content.includes('@fyit/crouton')
  } catch {
    return false
  }
}

/**
 * Add the @source directive to an existing CSS file
 */
async function addSourceDirective(cssPath: string, cssRelativePath: string): Promise<boolean> {
  const content = await fsp.readFile(cssPath, 'utf-8')

  // Calculate correct path based on CSS file location
  const nodeModulesPath = calculateNodeModulesPath(cssRelativePath)
  const sourceDirective = `@source "${nodeModulesPath}";`

  // Find where to insert (after @import statements)
  const lines = content.split('\n')
  let insertIndex = 0

  // Find the last @import line
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('@import')) {
      insertIndex = i + 1
    }
  }

  // Check if there's already an @source section
  const hasSourceSection = lines.some(line => line.trim().startsWith('@source'))

  // Build the new content
  let newContent: string
  if (hasSourceSection) {
    // Add after the last @source line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('@source')) {
        insertIndex = i + 1
      }
    }
    lines.splice(insertIndex, 0, sourceDirective)
    newContent = lines.join('\n')
  } else {
    // Add after imports with a comment
    const comment = '\n/* Scan Nuxt Crouton layers for Tailwind classes */\n'
    lines.splice(insertIndex, 0, comment + sourceDirective)
    newContent = lines.join('\n')
  }

  await fsp.writeFile(cssPath, newContent, 'utf-8')
  return true
}

/**
 * Create a new CSS file with proper Tailwind setup
 */
async function createCssFile(projectRoot = process.cwd()): Promise<CssFile> {
  // Prefer app/assets/css/main.css for Nuxt 4 projects
  const cssDir = path.join(projectRoot, 'app', 'assets', 'css')
  const cssPath = path.join(cssDir, 'main.css')
  const relativePath = 'app/assets/css/main.css'

  // Create directory if needed
  await fsp.mkdir(cssDir, { recursive: true })

  const nodeModulesPath = calculateNodeModulesPath(relativePath)

  const content = `@import "tailwindcss";
@import "@nuxt/ui";

/* Scan Nuxt Crouton layers for Tailwind classes */
@source "${nodeModulesPath}";
`

  await fsp.writeFile(cssPath, content, 'utf-8')
  return { path: cssPath, relativePath }
}

/**
 * Update nuxt.config.ts to include the CSS file
 */
async function ensureCssInNuxtConfig(projectRoot: string, cssRelativePath: string): Promise<boolean> {
  const configPath = path.join(projectRoot, 'nuxt.config.ts')

  // Normalize the path for Nuxt 4 (remove 'app/' prefix since ~/ points to project root)
  // In Nuxt 4, ~/assets/css/main.css resolves to app/assets/css/main.css
  const normalizedPath = cssRelativePath.replace(/^app\//, '')

  const result = await addToConfigArray(
    configPath,
    'css',
    `~/${normalizedPath}`,
    // Already included under either the original or the normalized path
    entries => entries.some(e => e.includes(cssRelativePath) || e.includes(normalizedPath)),
  )
  if (!result.added && result.reason !== 'already in config') {
    console.error(`Failed to update nuxt.config.ts: ${result.reason}`)
    return false
  }
  return true
}

/**
 * Main function to setup CSS @source directive for Nuxt Crouton
 */
export async function setupCroutonCssSource(projectRoot = process.cwd(), options: SetupOptions = {}): Promise<SetupResult> {
  const { silent = false, force = false } = options
  const log = silent ? (() => {}) : console.log

  try {
    // Find existing CSS file
    let cssFile = await findMainCssFile(projectRoot)

    if (cssFile) {
      // Check if already configured
      const hasDirective = await hasSourceDirective(cssFile.path)

      if (hasDirective && !force) {
        log(`✓ CSS @source directive already configured in ${cssFile.relativePath}`)
        return { success: true, action: 'already_configured', file: cssFile.relativePath }
      }

      // Add the directive
      await addSourceDirective(cssFile.path, cssFile.relativePath)
      log(`✓ Added @source directive to ${cssFile.relativePath}`)
      return { success: true, action: 'updated', file: cssFile.relativePath }
    }

    // No CSS file found, create one
    log(`↻ No CSS file found, creating app/assets/css/main.css...`)
    cssFile = await createCssFile(projectRoot)

    // Ensure it's included in nuxt.config.ts
    await ensureCssInNuxtConfig(projectRoot, cssFile.relativePath)

    log(`✓ Created ${cssFile.relativePath} with @source directive`)
    log(`✓ Updated nuxt.config.ts to include CSS file`)

    return { success: true, action: 'created', file: cssFile.relativePath }
  } catch (error: any) {
    if (!silent) {
      console.error(`Failed to setup CSS @source: ${error.message}`)
    }
    return { success: false, error: error.message }
  }
}

/**
 * Display instructions for manual setup if automatic setup fails
 */
export function displayManualCssSetupInstructions(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MANUAL CSS SETUP REQUIRED                                   ║
╚══════════════════════════════════════════════════════════════╝

Tailwind CSS v4 doesn't automatically scan npm packages.
Add this @source directive to your main CSS file:

  @source "../node_modules/@fyit/crouton*/app/**/*.{vue,js,ts}";

Example (app/assets/css/main.css):
────────────────────────────────────────────────────────────────
  @import "tailwindcss";
  @import "@nuxt/ui";

  /* Scan Nuxt Crouton layers for Tailwind classes */
  @source "../../../node_modules/@fyit/crouton*/app/**/*.{vue,js,ts}";
────────────────────────────────────────────────────────────────

Note: Adjust the "../" depth based on your CSS file location.
See: https://crouton.dev/getting-started/installation#configure-tailwind-css
`)
}

export default {
  setupCroutonCssSource,
  displayManualCssSetupInstructions,
}
