# @fyit/crouton-mcp-server

MCP (Model Context Protocol) server for AI-powered collection generation in Nuxt Crouton applications.

## Overview

This MCP server enables AI assistants like Claude to generate complete CRUD collections through a structured interface. It provides tools for schema design, validation, and collection generation by wrapping the Crouton CLI.

## Features

- **Schema Design** - Get field type reference and guidelines
- **Schema Validation** - Validate schema structure before generation
- **Collection Generation** - Execute the Crouton CLI to generate files
- **Project Discovery** - List existing collections and layers

## Installation

### In a Crouton Project

The MCP server is included in the monorepo. Build it with:

```bash
cd packages/nuxt-crouton-mcp-server
pnpm install
pnpm build
```

### Global Installation

```bash
npm install -g @fyit/crouton-mcp-server
```

## Configuration

### Claude Code

Add to your Claude Code MCP settings (`.claude/settings.json` or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "crouton": {
      "command": "node",
      "args": ["./packages/nuxt-crouton-mcp-server/dist/index.js"],
      "cwd": "/path/to/your/crouton-project"
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "crouton": {
      "command": "crouton-mcp",
      "cwd": "/path/to/your/crouton-project"
    }
  }
}
```

## Tools

### design_schema

Get field types and schema guidelines for creating a new collection.

**Input:**
- `collectionName` (string) - Name of the collection (singular, e.g., 'product')
- `description` (string) - Natural language description of the collection
- `layer` (string, optional) - Target layer name

**Returns:** Field type reference, schema template, and design guidelines.

### validate_schema

Validate a collection schema before generation.

**Input:**
- `schema` (object) - The schema object to validate
- `options` (object, optional) - Validation options (hierarchy, translations)

**Returns:** Validation result with errors and warnings.

### generate_collection

Execute collection generation using the Crouton CLI.

**Input:**
- `layer` (string) - Target layer name
- `collection` (string) - Collection name (singular)
- `schema` (object) - Validated schema object
- `options` (object, optional):
  - `dialect` - Database dialect: 'sqlite' | 'pg' (default: 'sqlite')
  - `hierarchy` - Enable tree structure (default: false)
  - `noTranslations` - Skip i18n fields (default: false)
  - `force` - Overwrite existing files (default: false)
  - `dryRun` - Preview without writing (default: false)

**Returns:** Generation result with created file paths.

### list_collections

List existing collections in the project.

**Input:**
- `layer` (string, optional) - Filter by specific layer

**Returns:** Array of collection information grouped by layer.

### list_layers

List available layers in the project.

**Returns:** Array of layer names found in the `layers/` directory.

## Resources

### crouton://field-types

Markdown-formatted field type reference with descriptions and examples.

### crouton://field-types/json

JSON field type definitions for programmatic use.

### crouton://schema-template

Example schema template demonstrating common patterns.

## Example Usage

When an AI assistant receives a request like "Create a products collection with name, price, and description", it can:

1. **Call `design_schema`** to get field type reference:
   ```json
   {
     "collectionName": "product",
     "description": "Products with name, price, description"
   }
   ```

2. **Create a schema** based on the reference:
   ```json
   {
     "id": { "type": "string", "meta": { "primaryKey": true } },
     "name": { "type": "string", "meta": { "required": true } },
     "price": { "type": "decimal", "meta": { "precision": 10, "scale": 2 } },
     "description": { "type": "text" }
   }
   ```

3. **Call `validate_schema`** to check the schema:
   ```json
   {
     "schema": { ... }
   }
   ```

4. **Call `generate_collection`** to create files:
   ```json
   {
     "layer": "shop",
     "collection": "product",
     "schema": { ... },
     "options": { "dialect": "sqlite" }
   }
   ```

## Field Types

| Type | Description | Zod | TypeScript |
|------|-------------|-----|------------|
| `string` | Short text (VARCHAR) | `z.string()` | `string` |
| `text` | Long text | `z.string()` | `string` |
| `number` | Integer | `z.number()` | `number` |
| `decimal` | Decimal/float | `z.number()` | `number` |
| `boolean` | True/false | `z.boolean()` | `boolean` |
| `date` | Timestamp | `z.date()` | `Date \| null` |
| `json` | JSON object | `z.record(z.any())` | `Record<string, any>` |
| `repeater` | Array of objects | `z.array(z.any())` | `any[]` |
| `array` | Array of strings | `z.array(z.string())` | `string[]` |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm typecheck

# Watch mode
pnpm dev

# Test server startup
node dist/index.js

# Test with MCP inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## Requirements

- Node.js >= 18
- `@fyit/crouton-cli` (peer dependency)

## Related

- [@fyit/crouton-core](https://www.npmjs.com/package/@fyit/crouton-core) - Core Crouton package
- [@fyit/crouton-cli](https://www.npmjs.com/package/@fyit/crouton-cli) - CLI generator

## License

MIT
