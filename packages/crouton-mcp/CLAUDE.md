# CLAUDE.md - @fyit/crouton-mcp

## Package Purpose

MCP (Model Context Protocol) server that enables AI assistants to generate Crouton collections through a structured interface. Provides tools for schema design, validation, and collection generation by wrapping the crouton CLI.

## Architecture

```
Hybrid Approach:
┌─────────────────────┐     ┌─────────────────────────────┐
│    MCP Server       │     │  Crouton Generator CLI      │
│  (Type Reference)   │────▶│  (Actual Generation)        │
│  (Validation)       │     │                             │
└─────────────────────┘     └─────────────────────────────┘
        │
        ▼
  Import types from generator (stays in sync)
```

## Tools

### Schema & Generation Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `design_schema` | Get field types and schema guidelines | First - before creating schema |
| `validate_schema` | Validate schema structure | After designing, before generating |
| `generate_collection` | Execute collection generation | After validation passes |
| `list_collections` | List existing collections | To understand project structure |
| `list_layers` | List available layers | To choose target layer |

### CLI Integration Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `cli_help` | Get CLI command help and usage | User needs command reference |
| `dry_run` | Preview generation without writing files | Before generate to verify output |
| `rollback` | Remove a generated collection | Undo or cleanup collections |
| `init_schema` | Generate starter schema templates | Getting started with new schema |

## Resources

| URI | Description |
|-----|-------------|
| `crouton://field-types` | Markdown field type reference |
| `crouton://field-types/json` | JSON field type definitions |
| `crouton://schema-template` | Example schema template |

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP server entry point |
| `src/tools/design-schema.ts` | Schema design tool |
| `src/tools/validate-schema.ts` | Schema validation tool |
| `src/tools/generate.ts` | CLI wrapper for generation |
| `src/tools/list-collections.ts` | Collection/layer scanning |
| `src/tools/cli-help.ts` | CLI command help reference |
| `src/tools/dry-run.ts` | Preview generation tool |
| `src/tools/rollback.ts` | Collection removal tool |
| `src/tools/init-schema.ts` | Starter schema templates |
| `src/utils/field-types.ts` | Field type definitions (sync with generator) |
| `src/utils/cli.ts` | CLI execution utilities |
| `src/utils/fs.ts` | Filesystem scanning utilities |

## Field Types

The **live source of truth is manifest loading** — `getTypeMapping()` in `packages/crouton-cli/lib/utils/manifest-loader.ts` builds the map from every package's `crouton.manifest.ts` (core's types: `packages/crouton-core/crouton.manifest.ts`). The hardcoded table in `src/utils/field-types.ts` is a **fallback used only when manifest loading fails** — keep it consistent with the core manifest:

| Type | Zod | TypeScript | Default |
|------|-----|------------|---------|
| string | `z.string()` | `string` | `''` |
| text | `z.string()` | `string` | `''` |
| number | `z.number()` | `number` | `0` |
| decimal | `z.number()` | `number` | `0` |
| boolean | `z.boolean()` | `boolean` | `false` |
| date | `z.date()` | `Date \| null` | `null` |
| json | `z.record(z.string(), z.any())` | `Record<string, any>` | `{}` |
| repeater | `z.array(z.any())` | `any[]` | `[]` |
| array | `z.array(z.string())` | `string[]` | `[]` |

## Usage Flow

### Standard Collection Generation
```
1. AI receives: "Create a products collection with name, price, description"

2. AI calls: design_schema({
     collectionName: "product",
     description: "Products with name, price, description"
   })
   → Returns field type reference and guidelines

3. AI creates schema and calls: validate_schema({
     schema: { name: {...}, price: {...}, description: {...} }
   })
   → Returns validation result

4. AI calls: dry_run({
     layer: "shop",
     collection: "product",
     schema: "{ ... }"
   })
   → Preview what files would be created

5. AI calls: generate_collection({
     layer: "shop",
     collection: "product",
     schema: { ... },
     options: { dialect: "sqlite" }
   })
   → Executes CLI, returns generated file paths
```

### Quick Start with Templates
```
1. AI calls: init_schema({ template: "ecommerce" })
   → Returns starter schema for products

2. AI modifies schema as needed

3. AI follows steps 3-5 from standard flow
```

### Getting CLI Help
```
AI calls: cli_help({ command: "generate" })
   → Returns detailed usage for generate command
```

### Removing a Collection
```
AI calls: rollback({
  layer: "shop",
  collection: "product",
  dryRun: true  // Preview first (default)
})
   → Shows what would be removed

AI calls: rollback({
  layer: "shop",
  collection: "product",
  dryRun: false  // Actually remove
})
   → Removes collection files
```

## Configuration

Add to Claude Code MCP settings:

```json
{
  "mcpServers": {
    "crouton": {
      "command": "node",
      "args": ["./packages/nuxt-crouton-mcp-server/dist/index.js"],
      "cwd": "/path/to/nuxt-crouton"
    }
  }
}
```

## Development

```bash
# Install dependencies
cd packages/nuxt-crouton-mcp-server
pnpm install

# Build
pnpm build

# Type check
pnpm typecheck

# Watch mode
pnpm dev
```

## Common Tasks

### Add a new tool

1. Create `src/tools/{name}.ts` with handler and definition
2. Export from `src/tools/index.ts`
3. Register in `src/index.ts` using `server.tool()`
4. Update this CLAUDE.md

### Add a new resource

1. Add `server.resource()` call in `src/index.ts`
2. Document in Resources table above

### Sync field types

If field types change in generator:
1. Update the owning package's `crouton.manifest.ts` (the live source), then mirror `src/utils/field-types.ts` (the fallback)
2. Update Field Types table in this file
3. Run `/sync-check` to verify all docs are in sync

## Dependencies

- **Extends**: `@modelcontextprotocol/sdk` (MCP protocol)
- **Wraps**: `@fyit/crouton-cli` (CLI)
- **Runtime**: Node.js >= 18

## Testing

```bash
# Test MCP server startup
node dist/index.js

# Test with MCP inspector (if available)
npx @modelcontextprotocol/inspector node dist/index.js
```

## Sync Checklist

When modifying this package:

- [ ] Fallback field types match the core manifest (`packages/crouton-core/crouton.manifest.ts`; check: `node scripts/validate-field-types-sync.mjs`)
- [ ] Tool definitions documented above
- [ ] Resource URIs documented above
- [ ] Changes propagated to `.claude/skills/crouton.md` if workflow affected
