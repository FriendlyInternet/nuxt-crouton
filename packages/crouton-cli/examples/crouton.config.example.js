/**
 * Exhaustive Crouton Configuration Example
 * =========================================
 *
 * This file demonstrates ALL available configuration options for the
 * nuxt-crouton-cli. Copy this file to `crouton.config.js`
 * and customize for your project.
 *
 * Usage:
 *   npx crouton-generate config ./crouton.config.js
 *   npx crouton-generate config ./crouton.config.js --only products
 *   npx crouton-generate --config ./crouton.config.js
 *
 * @see https://crouton.fyit.nl/generation/multi-collection
 * @see https://crouton.fyit.nl/generation/cli-reference
 */

export default {
  // ============================================================
  // FEATURE FLAGS (Unified Config)
  // ============================================================
  // Which crouton packages to enable.
  //
  // IMPORTANT: @fyit/crouton-core BUNDLES these packages automatically:
  //   - @fyit/crouton-auth  (Better Auth with teams)
  //   - @fyit/crouton-admin (Admin dashboard)
  //   - @fyit/crouton-i18n  (Multi-language support)
  //
  // DO NOT add auth, admin, or i18n to your nuxt.config.ts extends array
  // separately - they are included via crouton-core. Adding them separately
  // causes duplicate layer loading and SSR errors.
  //
  // Optional features (disabled by default):
  features: {
    editor: true,     // TipTap rich text editor
    pages: true,      // CMS pages system
    // bookings: true // Booking system
    // sales: true    // Point of Sale
    // email: true    // Email with Resend
    // assets: true   // Media library
    // events: true   // Audit trail
    // collab: true   // Real-time collaboration

    // AI/LLM integration - supports boolean or object config
    // ai: true,  // Uses OpenAI gpt-4o-mini by default
    // ai: { defaultModel: 'claude-sonnet-4-20250514' },  // Use Anthropic Claude
    // ai: { defaultModel: 'gpt-4o' },  // Use specific OpenAI model
  },

  // ============================================================
  // LOCALES (i18n Languages)
  // ============================================================
  // Supported languages for your app. Used by the i18n layer,
  // CLI generation (locale files), and the language switcher UI.
  //
  // Accepts ISO 639-1 codes ('en') or objects ({ code: 'en', name: 'English' }).
  // Common language names are auto-resolved from codes.
  //
  // @default ['en']
  // locales: ['en', 'de', 'es'],
  // defaultLocale: 'en',

  // ============================================================
  // DATABASE DIALECT
  // ============================================================
  // Required: 'pg' (PostgreSQL) or 'sqlite'
  // Affects generated schema types and query syntax
  dialect: 'sqlite',

  // ============================================================
  // COLLECTIONS DEFINITION (Enhanced Format - Recommended)
  // ============================================================
  // Define each collection with its own schema file.
  // This is the recommended approach for production projects.
  collections: [
    // Basic collection
    {
      name: 'products', // Collection name (plural, kebab-case recommended)
      fieldsFile: './schemas/products.json', // Path to JSON schema file
      // tests: false // Skip the schema-smoke test for this collection (emitted by
      //              // default, #785; equivalent to the global --no-tests flag)
    },

    // Collection with hierarchy support (tree structure)
    // Adds: parentId, path, depth, order fields
    // Generates: move & reorder API endpoints
    {
      name: 'categories',
      fieldsFile: './schemas/categories.json',
      hierarchy: true // Enable tree/nested structure
    },

    // Collection for pages with hierarchy
    {
      name: 'pages',
      fieldsFile: './schemas/pages.json',
      hierarchy: true
    },

    // Collection with sortable support (drag-and-drop reordering)
    // Adds: order field
    // Generates: reorder API endpoint
    {
      name: 'slides',
      fieldsFile: './schemas/slides.json',
      sortable: true // Enable drag-to-reorder (without hierarchy)
    },

    // Collection with collab presence support (realtime editing indicators)
    // Adds: show-collab-presence prop to List.vue
    // Requires: @fyit/crouton-collab to be extended
    {
      name: 'bookings',
      fieldsFile: './schemas/bookings.json',
      collab: true // Enable presence indicators in list view
    },

    // Collection with seed data generation
    // Generates: seed.ts file with drizzle-seed for realistic test data
    {
      name: 'authors',
      fieldsFile: './schemas/authors.json',
      seed: true // Generate seed file with default count (25)
    },

    // Collection with custom seed count
    {
      name: 'posts',
      fieldsFile: './schemas/posts.json',
      seed: { count: 50 } // Generate seed file with 50 records
    },

    // Publishable collection (auto-registers as page type in crouton-pages)
    // Requires: features.pages enabled and @fyit/crouton-pages installed
    // Items can be published as standalone pages with URLs, SEO, and status
    {
      name: 'bikes',
      fieldsFile: './schemas/bikes.json',
      publishable: true
    },

    // Simple collections (no seed)
    {
      name: 'orders',
      fieldsFile: './schemas/orders.json'
    },
    {
      name: 'tags',
      fieldsFile: './schemas/tags.json'
    }
  ],

  // ============================================================
  // SEED DATA CONFIGURATION
  // ============================================================
  // Global defaults for seed data generation.
  // Uses drizzle-seed + Faker to generate realistic test data.
  //
  // Per-collection seed settings override these defaults.
  // See collection examples above for per-collection usage.
  seed: {
    /**
     * defaultCount: Default number of records to seed
     * Can be overridden per-collection with seed: { count: N }
     *
     * @default 25
     */
    defaultCount: 25,

    /**
     * defaultTeamId: Team ID used for seeded records
     * All crouton collections are team-scoped.
     *
     * @default 'seed-team'
     */
    defaultTeamId: 'seed-team'
  },

  // ============================================================
  // TRANSLATIONS CONFIGURATION (i18n)
  // ============================================================
  // Define which fields are translatable per collection.
  // Translatable fields are moved to a translations JSON object
  // and rendered with CroutonI18nInput for per-language editing.
  //
  // When translations are configured:
  // 1. Fields listed here get CroutonI18nInput in forms
  // 2. Data is stored as: { translations: { en: {...}, nl: {...} } }
  // 3. The i18n layer is auto-added to nuxt.config.ts
  // 4. Locale files are created in layers/[layer]/i18n/locales/
  translations: {
    collections: {
      // Products: translate name and description per language
      products: ['name', 'description'],

      // Categories: translate name only
      categories: ['name', 'description'],

      // Posts: translate title, content, and excerpt
      posts: ['title', 'content', 'excerpt'],

      // Pages: full content translation
      pages: ['title', 'content', 'metaTitle', 'metaDescription']
    }
  },

  // ============================================================
  // TARGETS (Layer Organization)
  // ============================================================
  // Organize collections into domain-driven layers.
  // Each layer becomes a Nuxt layer in layers/[layer]/
  targets: [
    {
      layer: 'shop', // Layer name (creates layers/shop/)
      collections: ['products', 'categories', 'orders'] // Collections from above
    },
    {
      layer: 'content',
      collections: ['pages', 'posts', 'authors', 'tags', 'slides']
    }
  ],

  // ============================================================
  // FLAGS (Generation Behavior)
  // ============================================================
  flags: {
    // --------------------------------------------------------
    // AUTO-GENERATED FIELDS
    // --------------------------------------------------------

    // NOTE: Team fields (teamId, owner) are now ALWAYS included.
    // All generated endpoints use @crouton/auth for team-based authentication.
    // Do NOT define teamId or owner in your schema JSON - they're auto-generated.

    /**
     * useMetadata: Add timestamp and audit fields
     *
     * When true, automatically adds to ALL collections:
     * - createdAt (timestamp) - When record was created
     * - updatedAt (timestamp) - When record was last modified
     * - updatedBy (text) - User ID who last modified
     *
     * WARNING: Do NOT define these fields in your schema JSON
     * when this is true - they're auto-generated.
     *
     * @default true
     */
    useMetadata: true,

    // --------------------------------------------------------
    // GENERATION BEHAVIOR
    // --------------------------------------------------------

    /**
     * autoRelations: Generate relation helper comments
     *
     * Adds commented relation stubs in generated schemas
     * to help set up Drizzle relations manually.
     *
     * @default false
     */
    autoRelations: false,

    /**
     * noTranslations: Skip translation field generation
     *
     * When true, skips generating i18n-related code.
     * Use if you don't need multi-language support.
     *
     * @default false
     */
    noTranslations: false,

    /**
     * force: Overwrite existing files
     *
     * When true, regenerates and overwrites all files
     * without prompting. Use with caution!
     *
     * @default false
     */
    force: false,

    /**
     * noDb: Skip database table creation
     *
     * When true, generates code but doesn't create/update
     * database tables. Useful for code-only regeneration.
     *
     * @default false
     */
    noDb: false,

    /**
     * dryRun: Preview without creating files
     *
     * When true, shows what would be generated without
     * actually creating any files. Always use this first!
     *
     * @default false
     */
    dryRun: false
  }

  // ============================================================
  // LEGACY FORMAT (Simple/Single Schema)
  // ============================================================
  // Alternative format when all collections share the same schema.
  // NOT recommended for production - use `collections[]` instead.
  //
  // schemaPath: './crouton-schema.json',  // Single schema file
  // targets: [
  //   { layer: 'shop', collections: ['products'] }
  // ]
}

// ============================================================
// EXAMPLE SCHEMA FILES
// ============================================================
//
// Below are example schema JSON files that work with this config.
// Create these in a ./schemas/ directory.
//
// --- schemas/products.json ---
// {
//   "name": {
//     "type": "string",
//     "meta": {
//       "required": true,
//       "label": "Product Name",
//       "maxLength": 200,
//       "area": "main"
//     }
//   },
//   "description": {
//     "type": "text",
//     "meta": {
//       "label": "Description",
//       "area": "main"
//     }
//   },
//   "price": {
//     "type": "decimal",
//     "meta": {
//       "required": true,
//       "label": "Price",
//       "default": 0,
//       "area": "sidebar"
//     }
//   },
//   "categoryId": {
//     "type": "string",
//     "refTarget": "categories",
//     "meta": {
//       "label": "Category",
//       "area": "sidebar"
//     }
//   },
//   "inStock": {
//     "type": "boolean",
//     "meta": {
//       "default": true,
//       "label": "In Stock",
//       "area": "sidebar"
//     }
//   },
//   "publishedAt": {
//     "type": "date",
//     "meta": {
//       "label": "Publish Date",
//       "area": "meta"
//     }
//   },
//   "priceTiers": {
//     "type": "repeater",
//     "meta": {
//       "label": "Volume Pricing",
//       "repeaterComponent": "PriceTier",
//       "addLabel": "Add Tier",
//       "sortable": true,
//       "area": "main"
//     }
//   }
// }
//
// --- schemas/categories.json (with hierarchy) ---
// {
//   "name": {
//     "type": "string",
//     "meta": {
//       "required": true,
//       "label": "Category Name"
//     }
//   },
//   "description": {
//     "type": "text",
//     "meta": {
//       "label": "Description"
//     }
//   },
//   "slug": {
//     "type": "string",
//     "meta": {
//       "required": true,
//       "label": "URL Slug"
//     }
//   }
// }
// Note: parentId, path, depth, order are auto-added when hierarchy: true
//
// --- schemas/posts.json (with external reference) ---
// {
//   "title": {
//     "type": "string",
//     "meta": {
//       "required": true,
//       "label": "Title"
//     }
//   },
//   "content": {
//     "type": "text",
//     "meta": {
//       "label": "Content"
//     }
//   },
//   "authorId": {
//     "type": "string",
//     "refTarget": ":users",
//     "meta": {
//       "required": true,
//       "label": "Author",
//       "readOnly": true
//     }
//   },
//   "categoryId": {
//     "type": "string",
//     "refTarget": "categories",
//     "meta": {
//       "label": "Category"
//     }
//   },
//   "status": {
//     "type": "string",
//     "meta": {
//       "default": "draft",
//       "label": "Status"
//     }
//   }
// }
// Note: :users prefix references external users collection (triggers connector)
//
// ============================================================
// FIELD TYPE REFERENCE
// ============================================================
//
// | Type     | Zod             | TypeScript        | Default  | Input Component    |
// |----------|-----------------|-------------------|----------|-------------------|
// | string   | z.string()      | string            | ''       | UInput            |
// | text     | z.string()      | string            | ''       | UTextarea         |
// | number   | z.number()      | number            | 0        | UInput[number]    |
// | decimal  | z.number()      | number            | 0        | UInput[number]    |
// | boolean  | z.boolean()     | boolean           | false    | USwitch           |
// | date     | z.date()        | Date | null       | null     | CroutonCalendar   |
// | json     | z.record()      | Record<string,any>| {}       | UTextarea[JSON]   |
// | repeater | z.array()       | any[]             | []       | CroutonRepeater   |
// | array    | z.array(z.string()) | string[]      | []       | (custom)          |
//
// ============================================================
// META PROPERTIES REFERENCE
// ============================================================
//
// | Property             | Type    | Description                                    |
// |----------------------|---------|------------------------------------------------|
// | required             | boolean | Field is required (adds Zod .min(1) or similar)|
// | label                | string  | Human-readable label for form fields           |
// | default              | any     | Default value for new records                  |
// | maxLength            | number  | Max string length (adds Zod .max())            |
// | area                 | string  | Form area: 'main' | 'sidebar' | 'meta'        |
// | readOnly             | boolean | Display as non-editable card                   |
// | component            | string  | Custom input component name                    |
// | repeaterComponent    | string  | Component for repeater items                   |
// | addLabel             | string  | Button text for adding repeater items          |
// | sortable             | boolean | Enable drag-to-reorder for repeaters           |
// | dependsOn            | string  | Field name this depends on                     |
// | dependsOnField       | string  | Field in referenced record to load             |
// | dependsOnCollection  | string  | Collection to fetch dependent data from        |
// | displayAs            | string  | Display mode: 'slotButtonGroup'               |
// | translatable         | boolean | Mark field for i18n translation support        |
//
// ============================================================
// REFERENCE FIELDS
// ============================================================
//
// Basic reference (same layer):
// "categoryId": {
//   "type": "string",
//   "refTarget": "categories"
// }
// → Becomes: collection="shopCategories" (prefixed with layer)
//
// External reference (different layer or system):
// "authorId": {
//   "type": "string",
//   "refTarget": ":users"
// }
// → Becomes: collection="users" (no prefix, triggers connector)
//
// ============================================================
// CLI QUICK REFERENCE
// ============================================================
//
// Generate from config:
//   npx crouton-generate config
//   npx crouton-generate config ./crouton.config.js
//   npx crouton-generate config --only products
//   npx crouton-generate --config ./crouton.config.js
//
// Generate single collection:
//   npx crouton-generate shop products --fields-file=./schemas/products.json
//   npx crouton-generate shop products -f ./schemas/products.json --dialect=pg
//   npx crouton-generate content pages -f ./schemas/pages.json --hierarchy
//
// Generate with seed data:
//   npx crouton-generate shop products -f ./schemas/products.json --seed
//   npx crouton-generate shop products -f ./schemas/products.json --seed --count=100
//
// Preview changes:
//   npx crouton-generate config --dry-run
//   npx crouton-generate shop products -f ./schemas/products.json --dry-run
//
// Rollback:
//   npx crouton-generate rollback shop products
//   npx crouton-generate rollback shop products --dry-run
//   npx crouton-generate rollback-bulk --layer=shop
//   npx crouton-generate rollback-interactive
//
// Other commands:
//   npx crouton-generate init                    # Create example schema
//   npx crouton-generate add events              # Add event tracking layer
//   npx crouton-generate install                 # Install required modules
