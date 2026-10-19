# @fyit/crouton-i18n

Multi-language support layer for FYIT scaffolded collections. Bundled by `@fyit/crouton-core` (which extends it), so every crouton app has it.

## Features

- 🌍 Multi-language input components
- 🔄 Auto-sync with English as primary language
- 📝 Team-specific translation overrides
- 🎯 Built-in support for EN, NL, FR
- ⚡ Inherits all CRUD features from base layer
- 🗄️ Database-backed translations with JSON fallback

## Installation

```bash
# Install core (it bundles i18n); add i18n explicitly only to pin or override it
pnpm add @fyit/crouton-core @fyit/crouton-i18n
```

## Quick Start (Using Generator)

The easiest way to set up i18n is via the collection generator. When you generate a collection with translations enabled, **everything is configured automatically**.

### 1. Create a config file with translations

```javascript
// crouton.config.js
export default {
  collections: [
    { name: 'products', fieldsFile: './schemas/products.json' }
  ],
  targets: [
    { layer: 'shop', collections: ['products'] }
  ],
  translations: {
    collections: {
      products: ['name', 'description']  // Fields to translate
    }
  },
  dialect: 'sqlite'
}
```

### 2. Run the generator

```bash
crouton-generate --config ./crouton.config.js
```

### What the generator does automatically:

1. ✅ Creates `translations-ui.ts` schema in `server/database/schema/`
2. ✅ Exports the schema in `schema/index.ts`
3. ✅ Generates database migration
4. ✅ Adds `nuxt-crouton-i18n` to layer extends
5. ✅ Creates `i18n/locales/*.json` files with starter content
6. ✅ Configures i18n in the layer's `nuxt.config.ts`
7. ✅ Registers `translationsUi` collection in `app.config.ts`

### 3. Seed translations (optional)

Import your JSON locale files into the database:

```bash
# Preview what will be seeded
crouton-generate seed-translations --dry-run

# Seed all translations
crouton-generate seed-translations

# Seed from specific layer
crouton-generate seed-translations --layer bookings

# Generate SQL for manual insertion
crouton-generate seed-translations --sql > seed.sql
```

## Manual Configuration

If you're not using the generator, follow these steps:

### 1. Add layers to nuxt.config.ts

```typescript
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',  // Base layer (required; already bundles i18n)
    '@fyit/crouton-i18n'   // Optional: list explicitly to override its config
  ]
})
```

### 2. Copy the schema file

Create `server/database/schema/translations-ui.ts`:

```typescript
import { nanoid } from 'nanoid'
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
```

Export it in `server/database/schema/index.ts`:

```typescript
export * from './translations-ui'
```

### 3. Run migration

```bash
pnpm db:generate
```

### 4. Register the collection

In `app/app.config.ts`:

```typescript
import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    // ... other collections
  }
})
```

### 5. Create locale files

Create `layers/[your-layer]/i18n/locales/en.json`:

```json
{
  "yourLayer": {
    "collections": {
      "products": { "title": "Products" }
    }
  }
}
```

Configure in your layer's `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  i18n: {
    locales: [
      { code: 'en', file: 'en.json' },
      { code: 'nl', file: 'nl.json' },
      { code: 'fr', file: 'fr.json' }
    ],
    langDir: './locales'  // NOT './i18n/locales'!
  }
})
```

> ⚠️ **Important**: Use `langDir: './locales'` not `'./i18n/locales'`. The `@nuxtjs/i18n` module uses `restructureDir: 'i18n'` by default, so langDir is relative to the `i18n/` directory.

## Components

### CroutonI18nInput

Multi-language input for forms:

```vue
<CroutonI18nInput
  v-model="state.translations"
  :fields="['name', 'description']"
  :default-values="{
    name: state.name,
    description: state.description
  }"
  @update:english="(data) => { state[data.field] = data.value }"
  label="Translations"
/>
```

### CroutonI18nDisplay

Display translated content:

```vue
<CroutonI18nDisplay
  :translations="item.translations"
  :field="'name'"
  :fallback="item.name"
/>
```

### CroutonI18nLanguageSwitcher

Switch between available languages:

```vue
<CroutonI18nLanguageSwitcher />
```

## Composables

### useT()

Translation function with team override support:

```typescript
const { t, tContent, locale } = useT()

// UI translations (from database with JSON fallback)
const label = t('products.name')

// Entity content translations
const productName = tContent(product, 'name')
```

The `useT()` composable:
1. First checks team-specific overrides in the database
2. Falls back to system translations in the database
3. Falls back to JSON locale files
4. Returns `[key]` if no translation found

### useEntityTranslations()

Manage entity-specific translations:

```typescript
const { getTranslation, setTranslation } = useEntityTranslations()

const translated = getTranslation(entity.translations, 'name', 'nl')
```

### useTranslationsUi()

Access the translations collection config:

```typescript
const { schema, columns, config } = useTranslationsUi()
```

## Translation Architecture

```
┌─────────────────────────────────────────────────┐
│                   useT()                        │
├─────────────────────────────────────────────────┤
│  1. Team Override (DB)                          │
│     └─ translations_ui WHERE teamId = :team     │
│                                                 │
│  2. System Translation (DB)                     │
│     └─ translations_ui WHERE teamId IS NULL     │
│                                                 │
│  3. JSON Locale Files (fallback)                │
│     └─ layers/*/i18n/locales/*.json            │
│                                                 │
│  4. Key as fallback                             │
│     └─ Returns [keyPath] if nothing found       │
└─────────────────────────────────────────────────┘
```

## Seeding Translations

The seed CLI imports JSON locale files into the database as system-level translations.

### Quick Start

```bash
# From your project root
pnpm crouton:i18n:seed --dry-run  # Preview what will be seeded
pnpm crouton:i18n:seed --sql > seed.sql  # Generate SQL
pnpm crouton:i18n:seed  # Seed via API
```

### Locale Sources

The seed CLI discovers and reads from multiple locale sources (in order, later sources can override):

1. **nuxt-crouton-i18n/locales/** - i18n admin UI strings
2. **nuxt-crouton-supersaas/i18n/locales/** - App-level common strings
3. **[app]/layers/\*/i18n/locales/** - Domain layer strings
4. **[app]/i18n/locales/** - App-level overrides

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview translations without seeding |
| `--sql` | Output SQL statements for direct database use |
| `--api-url <url>` | API endpoint URL (default: http://localhost:3000) |
| `--team-id <id>` | Seed to specific team (default: null = system) |
| `--force` | Overwrite existing translations |
| `--source <dir>` | Seed from specific directory only |
| `-h, --help` | Show help message |

### SQL Output

For direct database insertion without running the Nuxt server:

```bash
# Generate SQL
pnpm crouton:i18n:seed --sql > seed.sql

# Apply to SQLite database
sqlite3 .data/hub/d1/your-db.sqlite < seed.sql
```

### Seeding via API

For dynamic environments or when the server is running:

```bash
# Default (localhost:3000)
pnpm crouton:i18n:seed

# Custom API URL
pnpm crouton:i18n:seed --api-url https://your-app.com
```

### What Gets Seeded

Each translation is seeded with:
- `teamId: null` - System-level translation
- `userId: 'system'` - Indicates seeded by CLI
- `isOverrideable: true` - Teams can override
- `namespace: 'ui'` - Standard UI namespace
- `category` - First segment of key path (e.g., "common" from "common.save")
- `values` - JSON object with all locale values

### Example Workflow

```bash
# 1. Preview what will be seeded
pnpm crouton:i18n:seed --dry-run

# 2. Generate and review SQL
pnpm crouton:i18n:seed --sql > seed.sql
cat seed.sql | head -50

# 3. Apply to database
sqlite3 .data/hub/d1/your-db.sqlite < seed.sql

# 4. Verify in app
# Navigate to /admin/translations to see seeded translations
```

## Customizing Locales

Override default locales in your nuxt.config:

```typescript
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-i18n'
  ],

  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'es', name: 'Español', file: 'es.json' },
      { code: 'de', name: 'Deutsch', file: 'de.json' }
    ]
  }
})
```

## Layer Architecture

```
@fyit/crouton-core (base CRUD - required)
    └─ extends @fyit/crouton-i18n (this layer - bundled)
```

## Troubleshooting

### "Cannot find module" for locale files

Check that `langDir` is relative to `i18n/` directory:

```typescript
// ❌ Wrong
langDir: './i18n/locales'

// ✅ Correct
langDir: './locales'
```

### Translations not appearing in dashboard

Ensure the collection is registered in `app.config.ts`:

```typescript
import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

croutonCollections: {
  translationsUi: translationsUiConfig
}
```

### Database table not created

Run migrations:

```bash
pnpm db:generate
# Restart dev server to apply
```

### useT() returns key instead of translation

1. Check that the translation exists in the database or JSON files
2. Verify the key path matches exactly (case-sensitive)
3. Check browser console for API errors

## Migration from Previous Versions

**Component prefix changed**: `Translations*` → `CroutonI18n*`

```bash
# Find and replace in your project
sed -i '' 's/<Translations/<CroutonI18n/g' **/*.vue
sed -i '' 's/<\/Translations/<\/CroutonI18n/g' **/*.vue
```

## License

MIT
