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

    // Auto-detect: enabled in dev, disabled in prod (unless explicitly set).
    // Pages handler (#3982): opt-in, and refused without crouton-pages + crouton-collab —
    // decided before anything is installed so a misconfigured app fails the build.
    const plan = resolveToolkitSetup(config, nuxt.options.dev, () =>
      layerPackageNames(getLayerDirectories(nuxt).map(d => d.root))
    )
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

    if (plan.pages) registerPagesHandler(nuxt)

    // 404 for /mcp and the toolkit's other routes; only named handlers like /mcp/pages pass
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
 * The pages handler sits outside server/mcp/ so the toolkit's scan never finds it on
 * its own; add its folder (relative — see PAGES_MCP_DIR) before definitions load, and
 * tell the mint endpoint it is served.
 */
function registerPagesHandler(nuxt: Nuxt): void {
  const hook = nuxt.hook as unknown as (name: 'mcp:definitions:paths', fn: (paths: McpDefinitionPaths) => void) => void
  hook('mcp:definitions:paths', (paths) => {
    paths.handlers = [...(paths.handlers ?? []), PAGES_MCP_DIR]
  })
  nuxt.options.runtimeConfig.croutonMcpToolkit = defu(
    nuxt.options.runtimeConfig.croutonMcpToolkit as Record<string, unknown> | undefined,
    { pages: true }
  )
}

function logEndpoints(dev: boolean, plan: ToolkitSetupPlan): void {
  const lines = [
    plan.genericTools && '🍞 crouton:mcp-toolkit ✓ MCP endpoint available at /mcp',
    plan.pages && '🍞 crouton:mcp-toolkit ✓ Pages tools available at /mcp/pages'
  ].filter(line => dev && line)
  for (const line of lines) console.log(line)
}

export type { CroutonMcpToolkitConfig } from './types'
