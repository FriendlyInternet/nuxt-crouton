# CLAUDE.md - @fyit/crouton-i18n

## Package Purpose

Multi-language support layer for Nuxt Crouton. Provides database-backed translations with JSON fallback, team-specific overrides, and multi-language input components.

## Key Files

| File | Purpose |
|------|---------|
| `app/composables/useT.ts` | Translation function with team override support |
| `app/composables/useEntityTranslations.ts` | Entity-specific translation helpers |
| `app/composables/useTranslationsUi.ts` | Translations collection config |
| `app/components/Input.vue` | Multi-language input component |
| `app/components/Display.vue` | Translated content display |
| `cli/seed.ts` | Translation seeding CLI |
| `locales/*.json` | Default locale files (en, es, fr, it, pt) |

## Translation Lookup Order

```
useT() lookup:
1. Team Override (DB) → translations_ui WHERE teamId = :team
2. System Translation (DB) → translations_ui WHERE teamId IS NULL
3. JSON Locale Files → layers/*/i18n/locales/*.json
4. Key as fallback → Returns [keyPath]
```

## Composables

```typescript
// Translation with team overrides
const { t, tContent, locale } = useT()
t('products.name')                    // UI translation
tContent(product, 'name')             // Entity content

// Entity translations
const { getTranslation, setTranslation } = useEntityTranslations()
getTranslation(entity.translations, 'name', 'nl')

// Collection config
const { schema, columns, config } = useTranslationsUi()
```

## Components

```vue
<!-- Multi-language input -->
<CroutonI18nInput
  v-model="state.translations"
  :fields="['name', 'description']"
  :default-values="{ name: state.name }"
  @update:english="(data) => { state[data.field] = data.value }"
/>

<!-- Multi-language input with AI translation -->
<CroutonI18nInput
  v-model="state.translations"
  :fields="['name', 'description']"
  show-ai-translate
  field-type="product"
/>

<!-- Display translated -->
<CroutonI18nDisplay
  :translations="item.translations"
  :field="'name'"
  :fallback="item.name"
/>

<!-- Language switcher -->
<CroutonI18nLanguageSwitcher />
```

### CroutonI18nInput Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `object` | - | Translation values (v-model) |
| `fields` | `string[]` | - | Fields to translate |
| `label` | `string` | - | Optional label |
| `error` | `string \| boolean` | - | Error state |
| `defaultValues` | `Record<string, string>` | - | Default values per field |
| `fieldComponents` | `Record<string, string>` | - | Custom components per field |
| `showAiTranslate` | `boolean` | `false` | Enable AI translation button |
| `fieldType` | `string` | - | Field type context for AI (e.g., 'product', 'email') |
| `activeLocale` | `string` | - | **Externally-controlled editing locale** (tabs layout). When set, this input edits that single locale and follows the value — so several inputs can share ONE language selector. Used by the pages editor's language bar (#307). |
| `hideLocaleSwitcher` | `boolean` | `false` | Hide the built-in EN/NL/FR locale strip. Pair with `activeLocale` + an external selector so switching lives in one place. |

### AI Translation

When `showAITranslate` is enabled, a "Translate" button appears next to the English reference when editing other languages. Clicking it sends the English text to `/api/ai/translate` (from `@fyit/crouton-ai`).

**Requirements:**
- `@fyit/crouton-ai` must be extended in your nuxt.config
- OpenAI API key must be configured (`NUXT_OPENAI_API_KEY`)

## Component Naming

All components auto-import with `CroutonI18n` prefix:
- `Input.vue` → `<CroutonI18nInput />`
- `Display.vue` → `<CroutonI18nDisplay />`
- `LanguageSwitcher.vue` → `<CroutonI18nLanguageSwitcher />`

## Database Schema

```typescript
// translations_ui table
{
  id: text (primary key, nanoid)
  userId: text (required)
  teamId: text (null = system-level)
  namespace: text (default: 'ui')
  keyPath: text (required)
  category: text (first segment of keyPath)
  values: json ({ en: '...', nl: '...', fr: '...' })
  isOverrideable: boolean (default: true)
  createdAt, updatedAt: timestamp
}
```

## CLI Commands

```bash
# Seed translations from JSON to database
crouton-generate seed-translations              # Via API
crouton-generate seed-translations --dry-run    # Preview
crouton-generate seed-translations --sql > seed.sql  # Generate SQL
crouton-generate seed-translations --layer shop # Specific layer
```

## Configuration

```typescript
// Layer nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton',
    '@fyit/crouton-i18n'
  ],
  i18n: {
    locales: [
      { code: 'en', file: 'en.json' },
      { code: 'nl', file: 'nl.json' }
    ],
    langDir: './locales'  // Relative to i18n/ dir!
  }
})
```

### Locales are driven by `crouton.config.js` (all crouton layers)

The active locale set comes from the app's `crouton.config.js` `locales` field —
**not** from per-package hardcoded arrays. All crouton layers that contribute
i18n locales (`crouton-i18n`, `crouton-core`, `crouton-auth`, `crouton-admin`,
`crouton-pages`, `crouton-sales`) call `getCroutonLocales()` from
`@fyit/crouton-i18n/config-utils`, so they stay in sync.

```js
// crouton.config.js
locales: ['nl'],        // single-language app → only the NL tab renders
defaultLocale: 'nl',
```

- If `locales` is **omitted**, the default is `en`, `nl`, `fr` (the set the
  packages historically hardcoded — preserves existing apps).
- If `locales` is set, you get **exactly** that set across every layer. Adding a
  locale code that no package ships a `{code}.json` for will warn/skip.
- The **base/required locale** in translation inputs (`CroutonI18nInput`,
  `FormTranslatableOptionItem`, etc.) — the tab marked `*`, the fallback source,
  and the value mirrored to a collection's root field — follows the configured
  `defaultLocale` (was previously hardcoded to `'en'`).
- **Language switchers auto-hide for single-locale apps.** `LanguageSwitcher`,
  `LanguageSwitcherIsland`, and the user-menu "Language" submenu
  (`useUserMenuItems`, crouton-auth) only render when `locales.length > 1`.

## Common Tasks

### Add new locale
1. Create `locales/{code}.json` with translations
2. Add locale to `nuxt.config.ts` i18n.locales array
3. Run seed if using database: `crouton-generate seed-translations`

### Add translatable field to collection
1. Add field to `translations.collections` in `crouton.config.js`
2. Regenerate collection: `crouton config`
3. Use `<CroutonI18nInput>` in form

### Override system translation for team
1. Insert into `translations_ui` with `teamId` set
2. Or use admin UI at `/admin/translations`

## Common Pitfalls

```typescript
// ❌ Wrong langDir path
langDir: './i18n/locales'

// ✅ Correct (relative to i18n/ directory)
langDir: './locales'
```

## Dependencies

- **Extends**: `@fyit/crouton` (required)
- **Peer deps**: `@nuxtjs/i18n ^9.0.0`, `drizzle-orm >=0.30.0`, `zod ^3.20.0`

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
```
