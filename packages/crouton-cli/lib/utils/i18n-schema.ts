// Export and manage the i18n (translationsUi) schema in the project's database schema index

import fsp from 'node:fs/promises'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { addSchemaExport } from './update-schema-index.ts'
import { registerTranslationsUiCollection } from './update-app-config.ts'
import { fileExists } from '@fyit/crouton-core/shared/utils/fs'

const execAsync = promisify(exec)

// Export i18n schema when translations are enabled
export async function exportI18nSchema(force: boolean = false): Promise<boolean> {
  const schemaDir = path.resolve('server', 'db')
  const schemaIndexPath = path.join(schemaDir, 'schema.ts')
  const translationsSchemaPath = path.join(schemaDir, 'translations-ui.ts')

  try {
    // Check if translations schema file already exists
    const schemaExists = await fileExists(translationsSchemaPath)

    if (schemaExists && !force) {
      console.log(`✓ Translations schema already exists`)
      // Still register the collection in app.config.ts
      await registerTranslationsUiCollection()
      return false
    }

    // Copy the schema file from the i18n package to local schema directory
    const i18nSchemaSource = `import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core'

/**
 * UI translations table for system translations and team-specific overrides
 *
 * System translations: teamId = null, isOverrideable = true
 * Team overrides: teamId = specific team ID
 */
export const translationsUi = sqliteTable('translations_ui', {
  id: text('id').primaryKey().$default(() => nanoid()),
  userId: text('user_id').notNull(),
  teamId: text('team_id'), // null means system/default translation
  namespace: text('namespace').notNull().default('ui'),
  keyPath: text('key_path').notNull(),
  category: text('category').notNull(),
  values: text('values', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  description: text('description'),
  isOverrideable: integer('is_overrideable', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, (table) => ({
  // Ensures unique combination of teamId + namespace + keyPath
  uniqueTeamNamespaceKey: unique().on(table.teamId, table.namespace, table.keyPath)
}))

export type TranslationsUi = typeof translationsUi.$inferSelect
export type NewTranslationsUi = typeof translationsUi.$inferInsert
`

    await fsp.writeFile(translationsSchemaPath, i18nSchemaSource)
    console.log(`✓ Created translations-ui.ts schema file`)

    // Update schema index to export from local file
    const schemaResult = await addSchemaExport(schemaIndexPath, './translations-ui')
    if (!schemaResult.added) {
      if (schemaResult.reason === 'already exported') {
        console.log(`✓ Schema index already exports translations-ui`)
        return false
      }
    } else {
      console.log(`✓ Added translations-ui to schema index`)
    }

    // Generate migration for the new table
    console.log(`↻ Generating migration for translations_ui table...`)
    console.log(`! Running: npx nuxt db generate (30s timeout)`)

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Command timed out after 30 seconds')), 30000)
      })

      const { stdout, stderr } = await Promise.race([
        execAsync('npx nuxt db generate'),
        timeoutPromise
      ])

      if (stderr && !stderr.includes('Warning')) {
        console.error(`! Drizzle warnings:`, stderr)
      }
      console.log(`✓ Migration generated for translations_ui table`)
      console.log(`! Migration will be applied when you restart the dev server.`)

      // Register the translationsUi collection in app.config.ts
      await registerTranslationsUiCollection()

      return true
    } catch (execError: any) {
      if (execError.message.includes('timed out')) {
        console.error(`✗ Migration generation timed out after 30 seconds`)
      } else {
        console.error(`✗ Failed to generate migration:`, execError.message)
      }
      console.log(`! You can manually run: npx nuxt db generate`)

      // Still register the collection even if migration failed
      await registerTranslationsUiCollection()

      return true // Still return true since schema export succeeded
    }
  } catch (error: any) {
    console.error(`! Could not export i18n schema:`, error.message)
    return false
  }
}
