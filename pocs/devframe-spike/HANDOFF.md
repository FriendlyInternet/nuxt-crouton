# devframe-spike — HANDOFF

Spike for epic #3109 / issue #3111. A throwaway crouton app that mounts a Devframe-based
"Crouton (Devframe)" panel in Nuxt DevTools v4 and answers `list-collections` over MCP.
`packages/*` is untouched.

## What it proves (observed, `nuxt dev`)
- DevTools **4.1.0** loads (`DevTools: … (v4.1.0)` in the dev log). This needs scoped pnpm overrides in the
  root `package.json` (the workspace pins `@nuxt/devtools[-kit]` to ^3.4.2): `devframe-spike>@nuxt/devtools[-kit]`
  AND `@nuxt/devtools@4>@nuxt/devtools-kit`. Without the latter, devtools 4 gets kit 3 and Nuxt fails with
  `does not provide an export named 'NUXT_DEVTOOLS_GROUP_ID'`.
- `/__crouton_df/` serves the Vite-built client; `__connection.json` advertises the side-car WebSocket (port 9999).
- `POST /__crouton_df/mcp` `tools/call crouton-df_list-collections` returns the package's
  `/__nuxt_crouton_devtools/api/collections` payload.
- Tool naming: `ctx.rpc.register` adds no namespace; MCP turns `:` into `_` → `crouton-df_list-collections`.
  `list-operations` has no `agent` field, so it is not an MCP tool. The built-in `devframe_state_read` is also listed.
- MCP is stateless (no `initialize` needed) and origin-gated: a foreign `Origin` gets 403.
- `pnpm check:prod-build` (nuxt build, then grep `.output/server` for `__crouton_df|crouton-df`) exits 0:
  no devframe code ships in a production build.
- The old package tab did **not** log `NDT_DEP_0005`; only `NDT_DEP_0003` (`extendServerRpc`) appeared.
  Likely because `@fyit/crouton-devtools` carries its own kit ^3. Not worked around.

## What it does NOT prove
- The dock iframe was not driven in a real browser (no DevTools UI in CI); the page URL, RPC and MCP were checked over HTTP.
- WebSocket RPC from the browser client (only the connection descriptor was checked).

## Design rules
- Everything is dev-only: `modules/crouton-devframe.ts` returns early unless `nuxt.options.dev`.
- No devframe file lives in a Nitro auto-scanned dir (`server/plugins|api|routes|middleware|tasks`); the plugin is
  `server/devframe/plugin.ts`, added through the `nitro:config` hook. `test/no-autoscan.test.ts` guards this.
- `auth: false` is acceptable only because of the dev-only guard.
- The client is built by `pnpm build:df-client` (runs in `predev`) into the gitignored `devframe-client-dist/`.
