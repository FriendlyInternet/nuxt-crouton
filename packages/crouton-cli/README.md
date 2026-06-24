# 🥖 Nuxt Crouton Collection Generator

A powerful CLI tool for generating complete CRUD collections in Nuxt Crouton applications. Generate API endpoints, components, database schemas, and more with a single command.

## Features

- 🚀 **Complete CRUD Generation** - API endpoints, Vue components, database schemas
- 🗄️ **Multi-Database Support** - PostgreSQL and SQLite
- 🎯 **Type-Safe** - Full TypeScript support with Zod validation
- 🌱 **Seed Data** - Generate realistic test data with drizzle-seed
- ✅ **Tests by Default** - Emits a runtime-free Zod schema-smoke test per collection (`--no-tests` to skip)
- 🔧 **Customizable** - Modify generated code to fit your needs
- 📦 **Zero Config** - Works out of the box with sensible defaults

## Installation

### Global Installation (Recommended)

```bash
npm install -g @fyit/crouton-cli
```

### Or use with npx

```bash
npx @fyit/crouton-cli <command>
```

## Quick Start

### 1. Create a Schema

First, create a JSON schema file defining your collection fields:

```bash
# Create an example schema
crouton-generate init

# Or create manually
cat > product-schema.json << EOF
{
  "id": {
    "type": "string",
    "meta": {
      "primaryKey": true
    }
  },
  "name": {
    "type": "string",
    "meta": {
      "required": true,
      "maxLength": 255
    }
  },
  "price": {
    "type": "decimal",
    "meta": {
      "precision": 10,
      "scale": 2
    }
  },
  "inStock": {
    "type": "boolean"
  }
}
EOF
```

### 2. Generate the Collection

```bash
crouton-generate shop products --fields-file=product-schema.json
```

This generates:
- Vue components (Form.vue, List.vue)
- Composables with Zod schemas
- API endpoints (GET, POST, PATCH, DELETE)
- Database schema and queries
- TypeScript types

### 3. Update Your Project

After generation:

1. Export the new schema in `server/database/schema/index.ts`:
   ```typescript
   export * from '~/layers/shop/collections/products/server/database/schema'
   ```

2. Run database migrations

3. Restart your Nuxt dev server

## Usage

### Using a Config File (Recommended for Complex Projects)

Create a `crouton.config.js` file:

```javascript
export default {
  schemaPath: './product-schema.json',
  dialect: 'sqlite',
  targets: [
    {
      layer: 'shop',
      collections: ['products']
    }
  ],
  flags: {
    noTranslations: true,
    force: true
  }
}
```

Then generate using:

```bash
# Using default config file (crouton.config.js)
crouton-generate config

# Or specify a custom config file
crouton-generate --config ./my-config.js

# Or use the config command
crouton-generate config ./my-config.js
```

### Basic Command (CLI Arguments)

```bash
crouton-generate <layer> <collection> [options]
```

### Options

- `--fields-file <path>` - Path to JSON schema file
- `--config <path>` - Use configuration file instead of CLI arguments
- `--dialect <pg|sqlite>` - Database dialect (default: pg)
- `--seed` - Generate seed data file with realistic test data
- `--count <number>` - Number of seed records to generate (default: 25)
- `--no-translations` - Skip translation fields
- `--no-tests` - Skip the per-collection schema-smoke test (emitted by default)
- `--force` - Force generation even if files exist
- `--no-db` - Skip database table creation
- `--dry-run` - Preview what will be generated
- `--auto-relations` - Add relation stubs in comments

### Config File Documentation

The configuration file allows you to define all generation settings in one place:

```javascript
// crouton.config.js
export default {
  // Path to your JSON schema file
  schemaPath: './product-schema.json',

  // Database dialect
  dialect: 'sqlite',

  // Target layers and collections
  targets: [
    {
      layer: 'shop',
      collections: ['products', 'categories']
    }
  ],

  // Optional flags
  flags: {
    noTranslations: true,
    force: true,
    noDb: false
  }
}
```

See `crouton.config.example.js` for a complete example with all available options.

## Schema Format

### Supported Types

- `string` - VARCHAR/TEXT field
- `text` - Long text field
- `number` - Integer field
- `decimal` - Decimal/float field
- `boolean` - Boolean field
- `date` - Timestamp field
- `json` - JSON/JSONB field

### Field Metadata

```json
{
  "fieldName": {
    "type": "string",
    "meta": {
      "primaryKey": true,      // Mark as primary key
      "required": true,         // Field is required
      "unique": true,          // Add unique constraint
      "maxLength": 255,        // Maximum string length
      "precision": 10,         // Decimal precision
      "scale": 2,              // Decimal scale
      "translatable": true     // Enable i18n translation support
    }
  }
}
```

### Translatable Fields

Mark fields for multi-language support using `translatable: true`:

```json
{
  "title": {
    "type": "string",
    "meta": { "required": true, "translatable": true }
  },
  "description": {
    "type": "text",
    "meta": { "translatable": true }
  }
}
```

Fields marked as translatable will:
- Generate `CroutonI18nInput` components in forms
- Store translations in a `translations` JSON field
- Require the `@fyit/crouton-i18n` package

### Translatable Repeater Fields

For repeater fields where each item needs per-item translations (e.g., time slots, dropdown options):

```json
{
  "slots": {
    "type": "repeater",
    "meta": {
      "translatableProperties": ["label", "description"],
      "properties": {
        "label": { "type": "string", "required": true, "label": "Slot Name" },
        "description": { "type": "text", "label": "Description" },
        "value": { "type": "string", "label": "Slot ID" }
      }
    }
  }
}
```

This generates:
- Typed item interface with translations support
- Item-level Zod schema for validation
- Language tabs UI with completion indicators in the form
- Non-translatable fields only shown when editing English

## Generated Structure

```
layers/[layer]/collections/[collection]/
├── app/
│   ├── components/
│   │   ├── Form.vue         # CRUD form with validation
│   │   └── List.vue         # Data table with actions
│   └── composables/
│       └── use[Collection].ts   # Zod schema, columns, config
├── server/
│   ├── api/teams/[id]/[collection]/
│   │   ├── index.get.ts     # GET all/by IDs
│   │   ├── index.post.ts    # CREATE
│   │   ├── [id].patch.ts    # UPDATE
│   │   └── [id].delete.ts   # DELETE
│   └── database/
│       ├── queries.ts       # Database query functions
│       └── schema.ts        # Drizzle schema
├── types.ts                 # TypeScript interfaces
└── nuxt.config.ts          # Layer configuration
```

## Examples

### E-commerce Products

```bash
# Create schema
cat > products.json << EOF
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "name": { "type": "string", "meta": { "required": true } },
  "description": { "type": "text" },
  "price": { "type": "decimal", "meta": { "precision": 10, "scale": 2 } },
  "inStock": { "type": "boolean" },
  "categoryId": { "type": "string" }
}
EOF

# Generate
crouton-generate shop products --fields-file=products.json
```

### User Management

```bash
# Create schema
cat > users.json << EOF
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "email": { "type": "string", "meta": { "required": true, "unique": true } },
  "name": { "type": "string", "meta": { "required": true } },
  "role": { "type": "string" },
  "active": { "type": "boolean" },
  "createdAt": { "type": "date" }
}
EOF

# Generate
crouton-generate admin users --fields-file=users.json
```

## Seed Data Generation

Generate realistic test data alongside your collections using drizzle-seed + Faker.

### CLI Usage

```bash
# Generate with seed data (25 records by default)
crouton-generate shop products --fields-file=products.json --seed

# Generate with custom record count
crouton-generate shop products --fields-file=products.json --seed --count=100
```

### Config File Usage

```javascript
// crouton.config.js
export default {
  collections: [
    { name: 'products', fieldsFile: './products.json', seed: true },           // 25 records
    { name: 'categories', fieldsFile: './categories.json', seed: { count: 50 } } // custom count
  ],
  seed: {
    defaultCount: 25,          // default for all collections
    defaultTeamId: 'seed-team' // team ID for seeded data
  },
  // ... other config
}
```

### Running Seeds

After generation, run the seed file:

```bash
npx tsx ./layers/shop/collections/products/server/database/seed.ts
```

Or import in your code:

```typescript
import { seedShopProducts } from './layers/shop/collections/products/server/database/seed'

await seedShopProducts({
  count: 100,
  teamId: 'my-team',
  reset: true // optionally clear existing data first
})
```

The seed generator auto-detects field names and generates appropriate data (emails, names, prices, descriptions, etc.).

## Requirements

- Node.js 18+
- Nuxt 3 or 4
- @fyit/crouton installed
- Drizzle ORM configured

## Integration with Nuxt Crouton

This generator is designed to work seamlessly with [@fyit/crouton](https://www.npmjs.com/package/@fyit/crouton).

First, install and configure Nuxt Crouton:

```bash
pnpm add @fyit/crouton
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton']
})
```

Then use this generator to create collections that automatically integrate with the Crouton layer.

## Tips

- Collections auto-register with Nuxt Crouton - no manual registration needed
- Generated forms include Zod validation
- API endpoints use team-based access control
- All TypeScript types are properly generated
- Components use Nuxt UI 4 components

## Customization

After generation, you can:
- Modify Form.vue for custom layouts
- Adjust List.vue columns
- Add custom query methods
- Extend API endpoints
- Add business logic

The generated code is yours to modify!

## AI-Powered Generation (MCP Server)

For AI-assisted collection generation, use the companion MCP server:

```bash
npm install -g @fyit/crouton-mcp
```

The MCP server enables AI assistants like Claude to:
- Design schemas using natural language descriptions
- Validate schemas before generation
- Execute collection generation with proper options
- List existing collections and layers

Configure in Claude Code or Claude Desktop to enable AI-powered collection creation.

See [@fyit/crouton-mcp](https://www.npmjs.com/package/@fyit/crouton-mcp) for setup instructions.

## Development

### Running Tests

```bash
cd packages/nuxt-crouton-cli

# Run all tests once
pnpm test

# Watch mode for development
pnpm test:watch
```

Tests cover:
- `lib/utils/helpers.mjs` - Case conversion, type mapping, seed generators
- `lib/generators/types.mjs` - TypeScript type generation
- `lib/generators/composable.mjs` - Composable generation

### Project Structure

```
lib/
├── generators/      # Template generators (14 files)
├── utils/           # Helper utilities (8 files)
└── generate-collection.mjs  # Main orchestrator
tests/
├── fixtures/        # Reusable test data
└── unit/            # Unit and snapshot tests
```

## License

MIT © FYIT

## Links

- [GitHub Repository](https://github.com/FriendlyInternet/nuxt-crouton)
- [Nuxt Crouton Package](https://www.npmjs.com/package/@fyit/crouton)
- [Report Issues](https://github.com/FriendlyInternet/nuxt-crouton/issues)