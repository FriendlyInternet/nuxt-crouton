/**
 * @fyit/crouton-mcp-toolkit Nuxt Module
 *
 * Integrates @nuxtjs/mcp-toolkit to expose Crouton collections
 * as MCP tools, resources, and prompts for AI assistants.
 */
import {
  defineNuxtModule,
  createResolver,
  installModule,
  addServerHandler,
  getLayerDirectories
} from '@nuxt/kit'
import { defu } from 'defu'
import type { Nuxt } from '@nuxt/schema'
import type { CroutonMcpToolkitConfig } from './types'
import { PAGES_MCP_DIR, layerPackageNames, resolveToolkitSetup, type ToolkitSetupPlan } from './lib/pages-handler'
import { resolveAiReady, type AiReadyConfig } from './lib/ai-ready'

export const name = '@fyit/crouton-mcp-toolkit'
export const version = '0.1.0'

const defaults: CroutonMcpToolkitConfig = {
  name: 'crouton',
  enabled: undefined, // auto-detect
  genericTools: true,
  pages: false
}

interface McpDefinitionPaths {
  tools?: string[]
  resources?: string[]
  prompts?: string[]
  handlers?: string[]
}

export default defineNuxtModule<CroutonMcpToolkitConfig>({
  meta: {
    name,
    version,
    configKey: 'croutonMcpToolkit',
    compatibility: {
      nuxt: '^3.14.0 || ^4.0.0'
    }
  },

  defaults,

  async setup(moduleConfig, nuxt) {
    const resolver = createResolver(import.meta.url)
    const config = defu(moduleConfig, defaults)

    const plan = planSetup(config, nuxt)
    if (!plan.enabled) return

    // nuxt-ai-ready's own MCP tools/resources default off (#3982) — see resolveAiReady
    const options = nuxt.options as unknown as { aiReady?: AiReadyConfig }
    options.aiReady = resolveAiReady(options.aiReady)

    // Install @nuxtjs/mcp-toolkit
    // The toolkit auto-discovers tools/resources/prompts from ALL Nuxt layers
    // via getLayerDirectories(). Since our files are at server/mcp/{tools,resources,prompts}/,
    // the default dir: 'mcp' resolves correctly for this layer.
    await installModule('@nuxtjs/mcp-toolkit', {
      name: config.name
    })

    if (plan.pagesAtRoot) registerPagesHandler(nuxt)

    // 404 for the toolkit's routes under /mcp; /mcp itself passes only when it serves the page tools
    if (!plan.genericTools) {
      addServerHandler({
        middleware: true,
        handler: resolver.resolve('./server/handlers/mcp-generic-gate')
      })
    }

    // Enable asyncContext so tools can use useEvent()
    nuxt.options.experimental = defu(nuxt.options.experimental, {
      asyncContext: true
    })

    // Add server utilities for auto-import
    nuxt.options.nitro = defu(nuxt.options.nitro, {
      imports: {
        dirs: [resolver.resolve('./server/utils')]
      }
    })

    // Transpile the module
    nuxt.options.build.transpile.push(resolver.resolve('./'))

    logEndpoints(nuxt.options.dev, plan)
  }
})

/**
 * Auto-detect: enabled in dev, disabled in prod (unless explicitly set).
 * Pages handler (#3982): opt-in, and refused without crouton-pages + crouton-collab —
 * decided before anything is installed so a misconfigured app fails the build.
 * Served at /mcp only with crouton-auth's sign-in on (`croutonAuth.mcpOAuth`, #4097).
 * Prints the plan's warnings and, when enabled, sets `runtimeConfig.croutonMcpToolkit.pagesAtRoot`.
 */
function planSetup(config: CroutonMcpToolkitConfig, nuxt: Nuxt): ToolkitSetupPlan {
  const mcpOAuth = (nuxt.options as { croutonAuth?: { mcpOAuth?: boolean } }).croutonAuth?.mcpOAuth === true
  const plan = resolveToolkitSetup(config, nuxt.options.dev, () =>
    layerPackageNames(getLayerDirectories(nuxt).map(d => d.root)), mcpOAuth
  )
  for (const warning of plan.warnings) console.warn(`🍞 crouton:mcp-toolkit ⚠ ${warning}`)
  if (!plan.enabled) return plan
  // Always set (even false): the /mcp gate reads it to decide whether /mcp itself passes
  nuxt.options.runtimeConfig.croutonMcpToolkit = defu(
    { pagesAtRoot: plan.pagesAtRoot },
    nuxt.options.runtimeConfig.croutonMcpToolkit as Record<string, unknown> | undefined
  )
  return plan
}

/**
 * The pages handler sits outside server/mcp/ so the toolkit's scan never finds it on
 * its own; add its folder (relative — see PAGES_MCP_DIR) before definitions load. Its
 * unnamed `index.ts` becomes the default handler, served at /mcp.
 */
function registerPagesHandler(nuxt: Nuxt): void {
  const hook = nuxt.hook as unknown as (name: 'mcp:definitions:paths', fn: (paths: McpDefinitionPaths) => void) => void
  hook('mcp:definitions:paths', (paths) => {
    paths.handlers = [...(paths.handlers ?? []), PAGES_MCP_DIR]
  })
}

function logEndpoints(dev: boolean, plan: ToolkitSetupPlan): void {
  const lines = [
    plan.genericTools && '🍞 crouton:mcp-toolkit ✓ MCP endpoint available at /mcp',
    plan.pagesAtRoot && '🍞 crouton:mcp-toolkit ✓ Pages tools available at /mcp'
  ].filter(line => dev && line)
  for (const line of lines) console.log(line)
}

export type { CroutonMcpToolkitConfig } from './types'
