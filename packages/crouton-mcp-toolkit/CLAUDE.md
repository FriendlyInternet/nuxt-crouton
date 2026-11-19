# CLAUDE.md - @fyit/crouton-mcp-toolkit

## Package Purpose

MCP Toolkit integration that automatically exposes all Crouton collections as MCP tools, resources, and prompts. Any AI assistant (Claude Desktop, Cursor, etc.) can discover and perform CRUD operations on your app's data via the Model Context Protocol.

**Key insight**: Uses generic tools + collection registry pattern. Add a collection, MCP works immediately — zero config.

## Key Files

| File | Purpose |
|------|---------|
| `module.ts` | Nuxt module — installs @nuxtjs/mcp-toolkit, enables asyncContext |
| `nuxt.config.ts` | Layer configuration |
| `server/utils/mcp-collections.ts` | Read collection registry from `appConfig.croutonCollections` |
| `server/utils/mcp-auth.ts` | Auth helper — delegates to crouton-auth's team resolution |
| `server/mcp/tools/list-collections.ts` | List all registered collections with metadata |
| `server/mcp/tools/list-items.ts` | List items from a collection (paginated) |
| `server/mcp/tools/get-item.ts` | Get single item by ID |
| `server/mcp/tools/create-item.ts` | Create a new item |
| `server/mcp/tools/update-item.ts` | Update an existing item |
| `server/mcp/tools/delete-item.ts` | Delete an item |
| `server/mcp/resources/collections-registry.ts` | All collections metadata as MCP resource |
| `server/mcp/resources/collection-schema.ts` | Per-collection field info (template resource) |
| `server/mcp/prompts/data-entry.ts` | Guided data creation prompt |
| `lib/pages-handler.ts` | `resolvePagesHandler` (the `pages` opt-in decision), `layerPackageNames`, `PAGES_MCP_DIR` |
| `server/handlers/mcp-generic-gate.ts` | `isBlockedGenericMcpPath` + the 404 middleware registered when `genericTools: false` |
| `server/mcp-pages/handlers/pages/` | The `/mcp/pages` handler (`index.ts`) and its five tools (`tools/*.ts`) |
| `server/mcp-pages/lib/{auth,tools,deps}.ts` | Pages-token check, the tool logic (injected deps, tested), the real deps |

## Architecture

```
AI Client (Claude Desktop, Cursor, etc.)
    │
    ▼  MCP Protocol (HTTP at /mcp)
@nuxtjs/mcp-toolkit
    │
    ▼  Auto-discovered from server/mcp/
crouton-mcp-toolkit tools
    │
    ▼  appConfig.croutonCollections
Collection Registry → $fetch → Existing API endpoints
    │
    ▼  resolveTeamAndCheckMembership
crouton-auth (team auth)
```

The generic collection tools accept `collection` (string) and `teamId` (string) params. They call existing API endpoints via `$fetch`, which respects all auth, validation, and business logic.

## Configuration

```typescript
// nuxt.config.ts — opt in by extending the layer
export default defineNuxtConfig({
  extends: ['@fyit/crouton-core', '@fyit/crouton-mcp-toolkit'],
  croutonMcpToolkit: {
    enabled: true  // default: on in dev, off in production
  }
})
```

### Module Options

| Option | Default | Description |
|--------|---------|-------------|
| `name` | `'crouton'` | MCP server name shown to clients |
| `enabled` | auto-detect | `true` in dev, `false` in prod (unless set) |
| `genericTools` | `true` | `false` answers 404 on `/mcp` (generic CRUD + token tools) and keeps only named handlers such as `/mcp/pages` |
| `pages` | `false` | `true` serves the live page tools at `/mcp/pages`; the build fails if crouton-pages or crouton-collab is not extended |

## Pages handler (`/mcp/pages`)

Lets Claude edit a page **live** (#3982): changes go into the page's live collab document, so they appear in the open editor without a reload. **The tools never save** — the owner reviews and clicks Save.

- **Opt-in:** `croutonMcpToolkit: { enabled: true, pages: true }` (velo also sets `genericTools: false`). Needs `@fyit/crouton-pages` and `@fyit/crouton-collab` extended (optional peers, plus `@fyit/crouton-layout` for `add_layout`).
- **Auth:** a team pages token in the URL (`/mcp/pages?token=…`) or `Authorization: Bearer`. Mint one as a team **admin** with `POST /api/teams/:id/mcp-tokens` `{ "scope": "pages" }` — the response's `url` is what you paste into the Claude app. 404 when the app has `pages` off. No session fallback; the team comes from the token, tools take no `teamId`.
- **Separation:** a pages token cannot use the generic tools (`requireMcpAuth` accepts only `mcp-toolkit` tokens) and a general token cannot use the pages tools.
- **Tools:** `list_pages` · `read_page { pageId, locale }` (live doc if any, else stored) · `edit_page { pageId, locale, action: insert|replace|delete, index, count?, blocks? }` · `list_layout_blocks` · `add_layout { pageId, locale, index, layout, height? }` (checked by crouton-layout's `checkLayoutForPlacement`: known blocks + viable at 1280, warnings at 768/375).
- A first edit on a page whose live document is empty seeds it from the stored content with the editor's deterministic seed, so the two merge.
- Live edits need collab (`"collab": true`): in production the server pushes through the collab worker's `POST /update`; velo's `wrangler.jsonc` sets `global_fetch_strictly_public` so the app Worker can reach it.

## Tools Reference

| Tool | Input | Description |
|------|-------|-------------|
| `list_app_collections` | (none) | Lists all collections with fields, apiPath, defaults |
| `list_items` | collection, teamId, locale?, page?, pageSize? | Paginated list |
| `get_item` | collection, teamId, itemId | Single item by ID |
| `create_item` | collection, teamId, data | Create new item |
| `update_item` | collection, teamId, itemId, data | Partial update |
| `delete_item` | collection, teamId, itemId | Permanent delete |

## Resources Reference

| Resource | URI | Description |
|----------|-----|-------------|
| `collections-registry` | `crouton://collections` | All collections metadata |
| `collection-schema` | `crouton://schema/{collection}` | Per-collection field info |

## Prompts Reference

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `data-entry` | collection, teamId | Guided item creation workflow |

## How MCP Toolkit Discovery Works

The `@nuxtjs/mcp-toolkit` module uses `getLayerDirectories()` from `@nuxt/kit` to scan ALL Nuxt layers for `server/mcp/{tools,resources,prompts}/` directories. Since `crouton-mcp-toolkit` is a layer, its definitions are automatically discovered without specifying absolute paths. The pages handler is deliberately outside that folder (`server/mcp-pages/`); the module adds it through the `mcp:definitions:paths` hook only when `pages: true`.

## Common Tasks

### Test with MCP Inspector
```bash
# Start your app
pnpm dev

# Use MCP Inspector to test
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

### Add a new tool
1. Create file in `server/mcp/tools/{tool-name}.ts`
2. Use `defineMcpTool()` with `inputSchema` and `handler`
3. Auto-discovered — no registration needed

### Add a new resource
1. Create file in `server/mcp/resources/{resource-name}.ts`
2. Use `defineMcpResource()` with `uri` and `handler`

## Dependencies

- **Requires**: `@nuxtjs/mcp-toolkit` (peer dep)
- **Uses**: `@fyit/crouton-auth` (for team auth, dynamic import)
- **Reads**: `appConfig.croutonCollections` (from crouton-core)
- **Enabled by**: extending the layer (`extends`); options under the `croutonMcpToolkit` config key

## Testing

```bash
pnpm typecheck && pnpm typecheck:packages  # from the repo root; see root CLAUDE.md "Post-change checks"
pnpm test           # vitest: pages opt-in, /mcp gate, pages tokens, tools, import boundary
pnpm build          # Build module
```
