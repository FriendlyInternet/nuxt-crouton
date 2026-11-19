import { defu } from 'defu'

export type AiReadyConfig = false | Record<string, unknown> | undefined

/**
 * nuxt-ai-ready (every crouton app has it via @nuxtjs/seo) adds its own site tools
 * to @nuxtjs/mcp-toolkit once it is installed, and those need its database
 * (drizzle-orm ^1). Default them off so turning the toolkit on never needs that
 * database; an app that wants them sets `aiReady.mcp` itself (#3982).
 * `false` (module disabled) is returned untouched.
 */
export function resolveAiReady(aiReady: AiReadyConfig): AiReadyConfig {
  if (aiReady === false) return false
  return defu(aiReady, { mcp: { tools: false, resources: false } })
}
