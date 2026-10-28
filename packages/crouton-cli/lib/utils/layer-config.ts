// Layer-level nuxt.config.ts management and i18n setup

import fsp from 'node:fs/promises'
import path from 'node:path'
import { toCase } from './helpers.ts'
import { addToNuxtConfigExtends, setConfigOptionIfMissing } from './update-nuxt-config.ts'

const DEFAULT_LOCALE_CODES = ['en']

// Update or create layer root nuxt.config.ts
export async function updateLayerRootConfig(layer: string, collectionName: string, hasTranslations: boolean = false, localeCodes: string[] = DEFAULT_LOCALE_CODES): Promise<void> {
  const cases = toCase(collectionName)
  const layerPath = path.resolve('layers', layer)
  const configPath = path.join(layerPath, 'nuxt.config.ts')

  try {
    let configExists = false

    // Check if config already exists
    try {
      await fsp.access(configPath)
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

      const config = `import { basename } from 'path'

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
      await fsp.mkdir(layerPath, { recursive: true })
      await fsp.writeFile(configPath, config)
    }

    const added = await addToNuxtConfigExtends(configPath, `./collections/${cases.plural}`)
    if (!added.added && added.reason !== 'already in config') {
      throw new Error(added.reason)
    }
    let needsUpdate = added.added || !configExists

    // Add i18n config block when translations are enabled and not already present
    if (hasTranslations) {
      const i18n = await setConfigOptionIfMissing(configPath, 'i18n', {
        locales: localeCodes.map(c => ({ code: c, file: `${c}.json` })),
        langDir: './locales',
      })
      needsUpdate ||= i18n.added
    }

    if (needsUpdate) {
      console.log(`✓ ${configExists ? 'Updated' : 'Created'} ${layer} layer root nuxt.config.ts`)
    } else {
      console.log(`✓ ${layer} layer root config already properly configured`)
    }

    // Ensure i18n locale files exist when i18n config is present
    const hasI18n = hasTranslations || /\bi18n\s*:/.test(await fsp.readFile(configPath, 'utf-8'))
    if (hasI18n) {
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
