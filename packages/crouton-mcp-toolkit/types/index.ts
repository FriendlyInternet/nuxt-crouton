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
   * `false` answers 404 on `/mcp` (and `/mcp/deeplink`, `/mcp/badge.svg`, any
   * other `/mcp/<name>`) and keeps only the named `/mcp/pages` handler.
   * @default true
   */
  genericTools?: boolean

  /**
   * Serve the live page tools at `/mcp/pages` (#3982). Needs
   * `@fyit/crouton-pages` and `@fyit/crouton-collab` extended — the build fails
   * otherwise.
   * @default false
   */
  pages?: boolean
}
