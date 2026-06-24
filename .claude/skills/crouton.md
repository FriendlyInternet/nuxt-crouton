# Crouton CRUD Generation Skill

This skill helps generate complete CRUD collections for Nuxt Crouton applications.

## CRITICAL: Documentation First

**ALWAYS check the documentation before generating collections.** The docs are comprehensive (54+ pages) and contain the most up-to-date information.

### Documentation Tools (Use These First!)

| Tool | Purpose | Example |
|------|---------|---------|
| `crouton_list_docs` | List all doc pages | Filter by section: `crouton_list_docs({ section: "generation" })` |
| `crouton_search_docs` | Search for topics | `crouton_search_docs({ query: "config file" })` |
| `crouton_get_doc` | Read full doc page | `crouton_get_doc({ path: "generation/multi-collection" })` |

**Key Documentation Sections:**
- `getting-started/` - Installation and first collection
- `generation/` - Schema format, CLI commands, config files
- `patterns/` - Common collection patterns
- `api-reference/` - Composables, components, server utils

**Documentation Location:**
- Local: `apps/docs/content/`
- Live: https://nuxt-crouton-docs.pages.dev/

### When to Use Docs

1. **Before creating any config file** - Check `generation/multi-collection` for proper format
2. **When unsure about field types** - Check `generation/schema-format`
3. **For advanced features** - Check `features/` section
4. **For CLI options** - Check `generation/cli-reference`

## MCP Tools Available

If the Crouton MCP server is configured, you can use these tools for AI-assisted generation:

### Schema & Generation Tools

| Tool | Purpose |
|------|---------|
| `design_schema` | Get field types and schema guidelines |
| `validate_schema` | Validate schema before generation |
| `generate_collection` | Execute CLI generation |
| `list_collections` | List existing collections |
| `list_layers` | List available layers |

### CLI Integration Tools

| Tool | Purpose |
|------|---------|
| `cli_help` | Get CLI command help and usage |
| `dry_run` | Preview generation without writing files |
| `rollback` | Remove a generated collection |
| `init_schema` | Generate starter schema templates |

**MCP Workflow:**
1. Call `design_schema` with collection description (or use `init_schema` for templates)
2. Build schema using returned field types
3. Call `validate_schema` to check schema
4. Call `dry_run` to preview what will be generated
5. **Schema sign-off gate (#314)** — run the **`schema-review`** skill and get **human sign-off**
   on the field table **before** generating (see the `schema-review` skill + the "Schema Sign-Off"
   rule in root `CLAUDE.md`). `validate_schema` is the machine check; this is the human one.
6. Call `generate_collection` to create files — **only after approval**

**Quick Commands:**
- Need CLI help? Call `cli_help({ command: "generate" })`
- Want to start with a template? Call `init_schema({ template: "ecommerce" })`
- Made a mistake? Call `rollback({ layer, collection, dryRun: true })` to preview

If MCP tools are not available, follow the manual process below.

## Trigger Phrases

Use this skill when the user mentions:
- "create a collection"
- "generate crud for"
- "add a new collection"
- "scaffold [collection name]"
- "crouton generate"
- "need a [model/entity/table] for"

## Quick Reference

### CLI Options

| Option | Description |
|--------|-------------|
| `--fields-file <path>` | Schema JSON file |
| `--dialect <pg\|sqlite>` | Database dialect (default: sqlite) |
| `--hierarchy` | Enable tree structure |
| `--seed` | Generate seed data file |
| `--count <n>` | Seed record count (default: 25) |
| `--no-tests` | Skip the per-collection schema-smoke test (emitted by default, #785) |
| `--dry-run` | Preview without writing |

### Field Types

| User Says | Schema Type | Example |
|-----------|-------------|---------|
| text, string, name, title | `string` | `"name": { "type": "string" }` |
| long text, description, content | `text` | `"description": { "type": "text" }` |
| number, count, quantity | `number` | `"quantity": { "type": "number" }` |
| price, amount, decimal | `decimal` | `"price": { "type": "decimal", "meta": { "precision": 10, "scale": 2 } }` |
| boolean, yes/no, active | `boolean` | `"active": { "type": "boolean" }` |
| date, timestamp, when | `date` | `"startDate": { "type": "date" }` |
| json, object, settings | `json` | `"settings": { "type": "json" }` |
| list of items, repeater | `repeater` | `"items": { "type": "repeater" }` |
| translatable list | `repeater` | See Translatable Repeater section below |
| tags, string list | `array` | `"tags": { "type": "array" }` |
| image, photo, picture | `image` | `"coverImage": { "type": "image" }` |
| file, attachment, document | `file` | `"attachment": { "type": "file" }` |

### Common Field Meta Options

```json
{
  "fieldName": {
    "type": "string",
    "meta": {
      "required": true,
      "maxLength": 255,
      "unique": true,
      "component": "EditorSimple",
      "group": "seoSettings"
    },
    "refTarget": "categories"
  }
}
```

### Select Dropdown (Static Options)

For fields with a fixed set of options, use `options` + `displayAs: "optionsSelect"`:

```json
{
  "status": {
    "type": "string",
    "meta": {
      "label": "Status",
      "options": ["draft", "published", "archived"],
      "displayAs": "optionsSelect",
      "required": true
    }
  }
}
```

Options are auto-formatted as labels: `"draft"` → `"Draft"`, `"in_progress"` → `"In Progress"`

### Select Dropdown (Database-Driven)

For options stored in another collection:

```json
{
  "category": {
    "type": "string",
    "meta": {
      "label": "Category",
      "displayAs": "optionsSelect",
      "optionsCollection": "settings",
      "optionsField": "categories",
      "creatable": true
    }
  }
}
```

### Translatable Repeater (Per-Item Translations)

For repeater fields where each item needs translations (e.g., time slots, options with labels):

```json
{
  "slots": {
    "type": "repeater",
    "meta": {
      "translatableProperties": ["label", "description"],
      "properties": {
        "label": { "type": "string", "required": true, "label": "Slot Name" },
        "description": { "type": "text", "label": "Description" },
        "value": { "type": "string", "label": "Slot ID" },
        "maxCapacity": { "type": "number", "label": "Max Capacity" }
      }
    }
  }
}
```

**Generated features:**
- Language tabs (EN, NL, FR, etc.) with completion indicators
- Non-translatable fields only shown in English locale
- Fallback placeholder showing English value when editing translations
- Typed item interface and Zod schema

**Data structure:**
```typescript
{
  id: "abc123",
  label: "morning",           // English (default)
  description: "Morning slot",
  value: "slot-1",            // Non-translatable
  translations: {
    label: { nl: "ochtend", fr: "matin" },
    description: { nl: "Ochtendslot", fr: "Créneau du matin" }
  }
}
```

## Process

### Step 1: Gather Requirements

Ask the user:
1. Collection name (singular form, e.g., "product")
2. Fields needed (name, type, validation)
3. Layer name (default: use domain name, e.g., "shop" for products)
4. Special features needed:
   - Translations? (i18n for multiple languages)
   - Hierarchy? (parent-child tree structure)
   - Maps? (address/location fields)
   - Collab? (show who's editing items in realtime)

### Step 2: Create Schema File

Create a JSON schema file:

```json
// schemas/{collection}.json
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "name": { "type": "string", "meta": { "required": true, "maxLength": 255 } },
  "description": { "type": "text" },
  "price": { "type": "decimal", "meta": { "precision": 10, "scale": 2 } },
  "active": { "type": "boolean" },
  "categoryId": { "type": "string", "refTarget": "categories" }
}
```

### Step 3: Create/Update crouton.config.js

```javascript
// crouton.config.js
export default {
  collections: [
    { name: '{collection}', fieldsFile: './schemas/{collection}.json' },
    { name: 'products', fieldsFile: './schemas/products.json', seed: true },  // with seed data
    { name: 'categories', fieldsFile: './schemas/categories.json', seed: { count: 50 } },
    { name: 'bookings', fieldsFile: './schemas/bookings.json', collab: true },  // collab presence
    { name: 'bikes', fieldsFile: './schemas/bikes.json', publishable: true },  // auto-registers as page type
    { name: 'articles', fieldsFile: './schemas/articles.json', kind: 'content' },  // shown under Content in sidebar
    { name: 'gallery', fieldsFile: './schemas/gallery.json', kind: 'media' }       // shown under Media in sidebar
  ],
  dialect: 'sqlite',  // or 'pg' for PostgreSQL
  seed: {
    defaultCount: 25,          // default records per collection
    defaultTeamId: 'seed-team' // team ID for seeded data
  },
  targets: [
    { layer: '{layer}', collections: ['{collection}'] }
  ],
  flags: {
    noTranslations: false,  // set true to skip i18n
    force: false
  }
}
```

### Step 3.5: Schema Sign-Off Gate (review before generating) — #314

**Before running the generator, review the data model with a human.** Run the **`schema-review`**
skill on the fieldsFile to render a readable field table + relationships, post it, and **wait for
sign-off** — a wrong type or missing relationship is cheap to fix now and expensive after
generation. Feedback goes inline on the committed `writeups/schema-reviews/<collection>.md`;
revise the schema JSON and re-render until approved (a **comment** containing `lgtm`/`approve` —
a reaction/label won't resume the pipeline, #572). Only then run Step
4. (This is the human gate on top of the machine `validate_schema`; reuses the #310 loop.)

### Step 4: Run Generator

```bash
# Using config file (recommended)
crouton config

# Or direct command
crouton {layer} {collection} --fields-file=./schemas/{collection}.json --dialect=sqlite
```

### Step 5: Post-Generation

1. Export schema in `server/database/schema/index.ts`:
   ```typescript
   export * from '~/layers/{layer}/collections/{collection}/server/database/schema'
   ```

2. Run database migration:
   ```bash
   pnpm db:generate
   ```

3. Restart dev server

4. Run typecheck:
   ```bash
   npx nuxt typecheck
   ```

### Step 6: Default Layout (generate → POC, #709)

The generator's final step runs the **deterministic layout pass** and writes
**`crouton.layout.json`** at the app root — a `layout_configs`-format tree that
arranges the just-generated collections into a good default (no LLM):

- a compound **calendar** present (bookings) → **calendar-primary**;
- otherwise list + form → **master-detail**; extra collections stacked;
- each block is data-bound (`config.collection`), and the arrangement is
  **viability-gated** (every block ≥ its `minWidth`, vertical fallback when a
  side-by-side split is too narrow).

`crouton-seed` upserts this tree into `layout_configs` (row `default`), so the
POC boots laid-out — editable in `CroutonLayout`, the layout is **data** not
`.vue`. Reviewed via the usual UI sign-off loop (#307: staging preview → `approve`).
The rule set lives in `crouton-layout/app/utils/layout-compose.ts`
(`composeDefaultLayout`, in the `@fyit/crouton-layout` package — #751);
the LLM `/layout` pass (#711) is gated and out of scope.

## Generated Files

```
layers/{layer}/collections/{collection}/
├── app/
│   ├── components/
│   │   ├── Form.vue          # CRUD form with Zod validation
│   │   └── List.vue          # Data table with actions
│   └── composables/
│       └── use{Layer}{Collection}s.ts  # Schema, columns, config
├── server/
│   ├── api/teams/[id]/{layer}-{collection}s/
│   │   ├── index.get.ts      # GET all / by IDs
│   │   ├── index.post.ts     # CREATE
│   │   ├── [id].patch.ts     # UPDATE
│   │   └── [id].delete.ts    # DELETE
│   └── database/
│       ├── schema.ts         # Drizzle ORM schema
│       ├── queries.ts        # Database operations
│       └── seed.ts           # Seed data (with --seed flag)
├── {Layer}{Collection}s.test.ts  # Zod schema-smoke test (#785) — skip with --no-tests
├── types.ts                  # TypeScript interfaces
├── nuxt.config.ts           # Layer configuration
└── README.md                # Collection documentation
```

A **schema-smoke test** is emitted per collection by default (#785): runtime-free
(zod only), it asserts the generated Zod schema accepts a valid record and rejects
an invalid one. `crouton init`/`scaffold-app` wire a `vitest.config.ts` + `test`
script so `pnpm test` runs them. The e2e fixture smoke still owns boot + CRUD.

### Running Seed Files

```bash
# Execute seed file directly
npx tsx ./layers/{layer}/collections/{collection}/server/database/seed.ts

# Or import and call programmatically
import { seed{Layer}{Collection}s } from '.../seed'
await seed{Layer}{Collection}s({ count: 100, teamId: 'my-team', reset: true })
```

## Examples

### Simple Product Collection

User: "Create a products collection with name, price, and description"

```json
// schemas/products.json
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "name": { "type": "string", "meta": { "required": true } },
  "description": { "type": "text" },
  "price": { "type": "decimal", "meta": { "precision": 10, "scale": 2 } }
}
```

```bash
crouton shop products --fields-file=./schemas/products.json --dialect=sqlite
```

### Collection with References

User: "Create a posts collection with title, content, and author reference"

```json
// schemas/posts.json
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "title": { "type": "string", "meta": { "required": true } },
  "content": { "type": "text", "meta": { "component": "EditorSimple" } },
  "authorId": { "type": "string", "refTarget": "users", "refScope": "adapter" }
}
```

### Hierarchical Collection

User: "Create a categories collection with parent-child support"

```bash
crouton shop categories --fields-file=./schemas/categories.json --hierarchy --dialect=sqlite
```

### Collection with Translations

```javascript
// crouton.config.js
export default {
  collections: [
    { name: 'products', fieldsFile: './schemas/products.json' }
  ],
  translations: {
    collections: {
      products: ['name', 'description']
    }
  },
  dialect: 'sqlite',
  targets: [
    { layer: 'shop', collections: ['products'] }
  ]
}
```

## Post-Generation: TipTap Renderer

If a collection uses a block editor (`"meta": { "component": "EditorBlocks" }`) with **custom TipTap node types**, update the server-side renderer at `packages/crouton-core/server/utils/tiptap-renderer.ts` to handle them. The renderer already handles standard nodes (paragraph, heading, lists, etc.) and built-in custom blocks (`imageBlock`, `embedBlock`). Unknown node types gracefully render their children, so nothing breaks — but custom rendering (e.g., a gallery block rendering a grid of images) requires adding a case to `renderNode()`.

## Common Issues

### "Collection not registered"
- Ensure collection is in `app.config.ts` croutonCollections
- Check collection name matches exactly (case-sensitive)

### Type errors after generation
- Run `npx nuxt typecheck`
- Export schema from `server/database/schema/index.ts`

### Form not showing fields
- Check schema JSON is valid
- Verify field types are supported
- Check for meta.primaryKey on id field

## Reference Documentation

- CLI: `packages/nuxt-crouton-cli/CLAUDE.md`
- MCP Server: `packages/nuxt-crouton-mcp-server/CLAUDE.md`
- Core Package: `packages/nuxt-crouton/CLAUDE.md`
- i18n Support: `packages/nuxt-crouton-i18n/CLAUDE.md`