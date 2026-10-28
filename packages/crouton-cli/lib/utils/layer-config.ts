// Layer-level nuxt.config.ts management and i18n setup

import fsp from 'node:fs/promises'
import path from 'node:path'
import { toCase } from './helpers.ts'
import { fileExists } from '@fyit/crouton-core/shared/utils/fs'

const DEFAULT_LOCALE_CODES = ['en']

// Update or create layer root nuxt.config.ts
export async function updateLayerRootConfig(layer: string, collectionName: string, hasTranslations: boolean = false, localeCodes: string[] = DEFAULT_LOCALE_CODES): Promise<void> {
  const cases = toCase(collectionName)
  const layerPath = path.resolve('layers', layer)
  const configPath = path.join(layerPath, 'nuxt.config.ts')

  try {
    let config
    let configExists = false

    // Check if config already exists
    try {
      config = await fsp.readFile(configPath, 'utf-8')
      configExists = true
    } catch {
      // Create new config
      console.log(`↻ Creating ${layer} layer root nuxt.config.ts`)

      // Include i18n config if translations are enabled
      const localeEntries = localeCodes.map(c => `      { code: '${c}', file: '${c}.json' }`).join(',\n')
      const i18nBlock = hasTranslations
        ? `,
  i18n: {
    locales: [
${localeEntries}
    ],
    langDir: './locales'
  }`
        : ''

      config = `import { basename } from 'path'

const layerName = basename(__dirname)

export default defineNuxtConfig({
  components: {
    dirs: [
      {
        path: './components',
        prefix: layerName
      }
    ]
  },
  extends: [
  ]${i18nBlock}
})
`
    }

    // Find the extends array — or inject one if missing (e.g. bare `defineNuxtConfig({})`)
    let extendsMatch = config.match(/extends:\s*\[([\s\S]*?)\]/)
    if (!extendsMatch) {
      // Config exists but has no extends array — inject one
      const insertPoint = config.match(/defineNuxtConfig\(\{/)
      if (insertPoint) {
        const idx = config.indexOf(insertPoint[0]) + insertPoint[0].length
        config = config.slice(0, idx) + '\n  extends: [\n  ],' + config.slice(idx)
        await fsp.writeFile(configPath, config)
        console.log(`  ✓ Added extends array to existing ${layer} layer root nuxt.config.ts`)
        // Re-match after injection
        extendsMatch = config.match(/extends:\s*\[([\s\S]*?)\]/)
      }
    }
    if (extendsMatch) {
      const currentExtends = extendsMatch[1]
      const newCollection = `'./collections/${cases.plural}'`

      // Parse existing entries
      let lines = currentExtends.split('\n')
        .map(line => line.trim().replace(/,$/, ''))
        .filter(line => line && line !== ',' && !line.startsWith('//'))

      // Deduplicate entries (normalize quotes for comparison)
      lines = [...new Set(lines.map(l => l.replace(/['"]/g, '\'')))]

      let needsUpdate = false

      // Check if collection needs to be added (with normalized check)
      if (!lines.includes(newCollection)) {
        lines.push(newCollection)
        needsUpdate = true
      }

      // REMOVED: Don't add @fyit/crouton-i18n to local layers
      // It's already inherited from the main config via @fyit/crouton-core
      // Adding it here causes duplicate module loading and SSR issues

      if (needsUpdate) {
        // Format with proper indentation
        const formattedLines = lines.map((line, index) => {
          return index < lines.length - 1 ? `    ${line},` : `    ${line}`
        })

        const updatedExtends = formattedLines.join('\n')
        config = config.replace(extendsMatch[0], `extends: [\n${updatedExtends}\n  ]`)
      }

      // Add i18n config block when translations are enabled and not already present
      if (hasTranslations && !config.includes('i18n:')) {
        config = await addI18nConfigToLayer(configPath, config, localeCodes)
        needsUpdate = true
      }

      if (needsUpdate) {
        await fsp.writeFile(configPath, config)
        console.log(`✓ ${configExists ? 'Updated' : 'Created'} ${layer} layer root nuxt.config.ts`)
      } else {
        console.log(`✓ ${layer} layer root config already properly configured`)
      }

      // Ensure i18n locale files exist when i18n config is present
      if (hasTranslations || config.includes('i18n:')) {
        const i18nLocalesPath = path.join(layerPath, 'i18n', 'locales')
        await fsp.mkdir(i18nLocalesPath, { recursive: true })
        for (const locale of localeCodes) {
          const localePath = path.join(i18nLocalesPath, `${locale}.json`)
          try {
            await fsp.access(localePath)
          } catch {
            await fsp.writeFile(localePath, '{}', 'utf-8')
            console.log(`  ✓ Created empty ${locale}.json locale file`)
          }
        }
      }
    }
  } catch (error: any) {
    console.error(`! Could not update ${layer} layer root nuxt.config.ts:`, error.message)
    console.log(`  Please manually add './collections/${cases.plural}' to the extends array`)
  }
}

// Setup i18n folder structure and locale files for a layer
export async function setupLayerI18n(layer: string, collectionName: string, localeCodes: string[] = DEFAULT_LOCALE_CODES): Promise<boolean> {
  const layerPath = path.resolve('layers', layer)
  const i18nPath = path.join(layerPath, 'i18n', 'locales')
  const cases = toCase(collectionName)

  try {
    // Create i18n/locales directory
    await fsp.mkdir(i18nPath, { recursive: true })

    // Generate locale files with collection translations template
    const locales = localeCodes

    for (const locale of locales) {
      const localePath = path.join(i18nPath, `${locale}.json`)

      // Check if file exists
      let content
      try {
        await fsp.access(localePath)
        // File exists, merge in new collection keys
        const existing = JSON.parse(await fsp.readFile(localePath, 'utf-8'))
        if (!existing[layer]) existing[layer] = { collections: {} }
        if (!existing[layer].collections) existing[layer].collections = {}
        if (!existing[layer].collections[cases.plural]) {
          existing[layer].collections[cases.plural] = { title: cases.pascalCasePlural }
        }
        content = existing
        await fsp.writeFile(localePath, JSON.stringify(content, null, 2))
        console.log(`  ✓ Updated ${locale}.json with ${cases.plural} translations`)
      } catch {
        // Create new file with initial structure
        content = {
          [layer]: {
            collections: {
              [cases.plural]: { title: cases.pascalCasePlural }
            }
          }
        }
        await fsp.writeFile(localePath, JSON.stringify(content, null, 2))
        console.log(`  ✓ Created ${locale}.json with ${cases.plural} translations`)
      }
    }

    console.log(`✓ Created i18n locale files in layers/${layer}/i18n/locales/`)
    return true
  } catch (error: any) {
    console.error(`! Could not setup i18n for layer ${layer}:`, error.message)
    return false
  }
}

// Add i18n config block to an existing nuxt.config.ts
export async function addI18nConfigToLayer(configPath: string, config: string, localeCodes: string[] = DEFAULT_LOCALE_CODES): Promise<string> {
  // Check if i18n config already exists
  if (config.includes('i18n:')) {
    return config // Already has i18n config
  }

  // Find the closing of defineNuxtConfig and add i18n before it
  const localeEntries = localeCodes.map(c => `      { code: '${c}', file: '${c}.json' }`).join(',\n')
  const i18nConfig = `
  i18n: {
    locales: [
${localeEntries}
    ],
    langDir: './locales'
  }`

  // Find the last closing brace before the final })
  // Strategy: Add after extends array
  const extendsMatch = config.match(/extends:\s*\[[\s\S]*?\]/)
  if (extendsMatch) {
    const insertPos = config.indexOf(extendsMatch[0]) + extendsMatch[0].length
    // Check if there's a comma after extends
    const afterExtends = config.slice(insertPos)
    if (afterExtends.trim().startsWith(',')) {
      // Already has comma, insert i18n after the comma
      const commaPos = insertPos + afterExtends.indexOf(',') + 1
      config = config.slice(0, commaPos) + i18nConfig + ',' + config.slice(commaPos)
    } else {
      // No comma, add one
      config = config.slice(0, insertPos) + ',' + i18nConfig + config.slice(insertPos)
    }
  }

  // Create corresponding locale files so the app doesn't error on startup
  const layerDir = path.dirname(configPath)
  const localesDir = path.join(layerDir, 'i18n', 'locales')
  await fsp.mkdir(localesDir, { recursive: true })
  for (const locale of localeCodes) {
    const localePath = path.join(localesDir, `${locale}.json`)
    if (!await fileExists(localePath)) {
      await fsp.writeFile(localePath, '{}', 'utf-8')
      console.log(`  ✓ Created empty ${locale}.json locale file`)
    }
  }

  return config
}
