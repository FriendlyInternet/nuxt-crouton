/**
 * Tool scopes an MCP client (Claude, ChatGPT, …) may ask for (#4096).
 *
 * One scope per tool set. Today only `pages` (crouton-pages' live page tools).
 * A package that adds tools (e.g. bookings) adds its scope here, in the one
 * place `mcp()` reads it from. `offline_access` is added by `auth.ts` on top
 * of this list (it is a sign-in-server scope, not a tool scope).
 */
export const mcpScopes: string[] = ['pages']
