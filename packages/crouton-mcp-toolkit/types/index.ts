export interface CroutonMcpToolkitConfig {
  /**
   * MCP server name displayed to clients
   * @default 'crouton'
   */
  name?: string

  /**
   * Enable/disable the MCP toolkit
   * @default true in development, false in production
   */
  enabled?: boolean

  /**
   * Serve the generic collection CRUD + token tools at `/mcp`.
   * `false` answers 404 on `/mcp/*` (`/mcp/deeplink`, `/mcp/badge.svg`, any
   * `/mcp/<name>`); `/mcp` itself serves the page tools only when `pages` and
   * `croutonAuth.mcpOAuth` are both on. `true` cannot be combined with
   * `croutonAuth.mcpOAuth` (build error).
   * @default true
   */
  genericTools?: boolean

  /**
   * Serve the live page tools at `/mcp` when `croutonAuth.mcpOAuth` is on
   * (#3982, #4097) — else a build warning and no page tools. Needs
   * `@fyit/crouton-pages` and `@fyit/crouton-collab` extended — the build fails
   * otherwise.
   * @default false
   */
  pages?: boolean
}
