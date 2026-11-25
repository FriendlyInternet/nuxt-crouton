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
| `lib/pages-handler.ts` | `resolvePagesHandler` (the `pages` opt-in decision), `resolveToolkitSetup` (with `croutonAuth.mcpOAuth` → `pagesAtRoot`), `layerPackageNames`, `PAGES_MCP_DIR` |
| `server/handlers/mcp-generic-gate.ts` | `isBlockedGenericMcpPath` + the 404 middleware registered when `genericTools: false` |
| `server/mcp-pages/index.ts` | The `/mcp` default handler: the sign-in check (middleware) and the six page tools |
| `server/mcp-pages/tools/` | The six page tools, incl. `list_teams` (thin glue over `lib/tools.ts`) |
| `server/mcp-pages/lib/{auth,tools,deps,team-lookup}.ts` | Sign-in token check (JWT + consent), the tool logic (injected deps, tested), the real deps, the real team lookups |

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
| `genericTools` | `true` | `false` answers 404 on `/mcp/*`; `/mcp` itself serves the page tools only when `pages` + `croutonAuth.mcpOAuth` are both on. `true` cannot be combined with `croutonAuth.mcpOAuth` (build error) |
| `pages` | `false` | `true` serves the live page tools at `/mcp` when `croutonAuth.mcpOAuth` is on (else a build warning, no page tools); the build fails if crouton-pages or crouton-collab is not extended |

## Page tools at `/mcp`

Lets Claude edit a page **live** (#3982): changes go into the page's live collab document, so they appear in the open editor without a reload. **The tools never save** — the owner reviews and clicks Save.

- **Opt-in:** `croutonMcpToolkit: { enabled: true, genericTools: false, pages: true }` plus `croutonAuth: { mcpOAuth: true }`. Needs `@fyit/crouton-pages` and `@fyit/crouton-collab` extended (optional peers, plus `@fyit/crouton-layout` for `add_layout`).
- **Auth:** OAuth sign-in only (crouton-auth's MCP OAuth, #4096); paste `<origin>/mcp` into the Claude app. Every request needs `Authorization: Bearer` with a JWT for `<origin>/mcp` carrying the `pages` scope; no token → 401 with a `WWW-Authenticate` challenge. The team is a tool argument, checked with `canEditPages(teamId, userId)` (today: admin or owner); a revoked connection gets 401 on its next request (its consent row is gone).
- **Separation:** sign-in tokens only open the page tools; `requireMcpAuth` (generic tools) accepts only `mcp-toolkit` member tokens, and the two cannot be on together.
- **Tools:** `list_teams` · `list_pages { team }` · `read_page { team, pageId, locale }` (live doc if any, else stored) · `edit_page { team, pageId, locale, action: insert|replace|delete, index, count?, blocks? }` · `list_layout_blocks` · `add_layout { team, pageId, locale, index, layout, height? }` (checked by crouton-layout's `checkLayoutForPlacement`: known blocks + viable at 1280, warnings at 768/375).
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

The `@nuxtjs/mcp-toolkit` module uses `getLayerDirectories()` from `@nuxt/kit` to scan ALL Nuxt layers for `server/mcp/{tools,resources,prompts}/` directories. Since `crouton-mcp-toolkit` is a layer, its definitions are automatically discovered without specifying absolute paths. The pages handler is deliberately outside that folder (`server/mcp-pages/`); the module adds it through the `mcp:definitions:paths` hook only when `pages: true` **and** `croutonAuth.mcpOAuth` are both on; it then serves the page tools at `/mcp` as the default handler (`server/mcp-pages/index.ts`).

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
pnpm test           # vitest: pages opt-in, /mcp gate, sign-in tokens, tools, import boundary
pnpm build          # Build module
```
