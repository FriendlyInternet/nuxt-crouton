import { defineNuxtModule, createResolver, addServerHandler, addPlugin, addImports, useLogger } from '@nuxt/kit'
import { addCustomTab } from '@nuxt/devtools-kit'
import { createCroutonSrcTransform } from './runtime/transform/croutonSrc'
import { resolveDevtools } from './resolve-enabled'

export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@fyit/crouton-devtools',
    configKey: 'croutonDevtools',
    compatibility: {
      nuxt: '^4.0.0'
    }
  },
  defaults: {},
  async setup(_options, nuxt) {
    // --- Unified dev-tools gating (#811) ------------------------------------
    // One flag drives the whole glasses menu. The default is folder-detected
    // from rootDir (on under pocs/ + fixtures/, off under apps/), always on in
    // local dev; NUXT_PUBLIC_CROUTON_DEVTOOLS=true|false overrides either way.
    // The legacy NUXT_PUBLIC_CROUTON_REVIEW / _ERUDA flags live on as on-only
    // deprecated aliases for one transition.
    const { menuEnabled, annotateMachineryOn, deprecatedAliases } = resolveDevtools({
      rootDir: nuxt.options.rootDir,
      dev: nuxt.options.dev,
      devtools: process.env.NUXT_PUBLIC_CROUTON_DEVTOOLS,
      review: process.env.NUXT_PUBLIC_CROUTON_REVIEW,
      eruda: process.env.NUXT_PUBLIC_CROUTON_ERUDA
    })

    if (deprecatedAliases.length) {
      useLogger('@fyit/crouton-devtools').warn(
        `Deprecated flag${deprecatedAliases.length > 1 ? 's' : ''} ${deprecatedAliases.join(' / ')} — `
        + 'use NUXT_PUBLIC_CROUTON_DEVTOOLS=true instead (the old flags are honoured as aliases for one transition).'
      )
    }

    // --- Preview-review source stamping (epic #488, #490) -------------------
    // Inject `data-crouton-src="<relative .vue path>"` on each component's root
    // element at COMPILE time, so a click on a deployed staging preview resolves
    // to the owning source file (the capture half of the agent sign-off loop).
    //
    // Tied to Annotate: installed whenever the menu ships in a real (non-dev)
    // build — so the Annotate tool can resolve files + post feedback on a staging
    // preview — NEVER production (apps are menu-off by default). Flag absent →
    // transform not installed → zero attributes in the build. Runs BEFORE the
    // dev-only early return below because staging is a non-dev build.
    if (annotateMachineryOn) {
      const reviewResolver = createResolver(import.meta.url)

      // 1. Stamp components with their source path (#490).
      nuxt.options.vite ||= {}
      const vite = nuxt.options.vite as Record<string, any>
      vite.vue ||= {}
      vite.vue.template ||= {}
      vite.vue.template.compilerOptions ||= {}
      const compilerOptions = vite.vue.template.compilerOptions
      compilerOptions.nodeTransforms = [
        ...(compilerOptions.nodeTransforms || []),
        createCroutonSrcTransform(nuxt.options.rootDir)
      ]

      // 2. Server bridge: POST /api/_review → GitHub PR comment (#491).
      // Credentials stay server-side; populated at runtime from Worker env so
      // nothing ships in the bundle. The bridge posts as the Crouton GitHub App
      // (#519) — it mints a short-lived installation token from these keys; the
      // standalone PAT (githubToken) remains only as an interim fallback.
      // Empty-string defaults exist so the NUXT_CROUTON_REVIEW_* env vars can
      // override them at runtime (Nuxt only maps env onto keys already present).
      // repository/pr may be baked from the build env.
      ;(nuxt.options.runtimeConfig as Record<string, any>).croutonReview = {
        githubAppId: '',
        githubAppPrivateKey: '',
        githubAppInstallationId: '',
        githubToken: '', // interim PAT fallback (#519) — never production
        repository: process.env.GITHUB_REPOSITORY || '',
        pr: process.env.CROUTON_REVIEW_PR || ''
      }
      addServerHandler({
        route: '/api/_review',
        handler: reviewResolver.resolve('./runtime/server/api/review.post'),
        method: 'post'
      })
    }

    // --- Unified dev-tools launcher + tool registry (#809, #811) ------------
    // One neutral glasses launcher → a Nuxt UI dropdown of pluggable tools.
    // Tools register themselves via useCroutonDevTools().registerTool(); the
    // launcher only renders the registry, so adding the next tool is one call,
    // not another floating button. Console + Annotate fold in as the first two
    // tools (#810).
    //
    // Gated by the unified `menuEnabled` decision (#811): local dev, the
    // folder default (on under pocs/ + fixtures/), or the
    // NUXT_PUBLIC_CROUTON_DEVTOOLS override (the legacy _REVIEW/_ERUDA flags map
    // onto it as deprecated aliases). Registered BEFORE the dev-only early
    // return so a flagged staging build gets it too; the plugins runtime-gate on
    // `runtimeConfig.public.croutonDevtools` as well, so production ships nothing.
    if (menuEnabled) {
      const devtoolsResolver = createResolver(import.meta.url)
      nuxt.options.runtimeConfig.public ||= {}
      ;(nuxt.options.runtimeConfig.public as Record<string, any>).croutonDevtools = true
      addImports({
        name: 'useCroutonDevTools',
        from: devtoolsResolver.resolve('./runtime/composables/useCroutonDevTools')
      })
      addPlugin({
        src: devtoolsResolver.resolve('./runtime/plugins/crouton-devtools.client'),
        mode: 'client'
      })
      // The first two tools (#810): Console (eruda) + Annotate (pin → /api/_review).
      addPlugin({
        src: devtoolsResolver.resolve('./runtime/plugins/tools/console.client'),
        mode: 'client'
      })
      addPlugin({
        src: devtoolsResolver.resolve('./runtime/plugins/tools/annotate.client'),
        mode: 'client'
      })
    }

    // Only enable in development mode
    if (nuxt.options.dev === false) {
      return
    }

    const resolver = createResolver(import.meta.url)

    // Read croutonApps registry from merged app config
    const croutonApps = (nuxt.options.appConfig as any)?.croutonApps ?? {}

    // Detect if nuxt-crouton-events package is installed
    // (crouton-events registers itself in app/app.config.ts under croutonApps.events)
    const hasEventsPackage = 'events' in croutonApps

    // Collect API route prefixes from all croutonApps registrations.
    // Each package declares apiRoutes in its app/app.config.ts entry so the
    // tracker can match custom routes beyond /api/crouton-collection/*.
    const apiRoutePrefixes: Array<{ prefix: string, routeGroup: string }> = []
    for (const [appId, appConfig] of Object.entries(croutonApps)) {
      const routes = (appConfig as any)?.apiRoutes
      if (Array.isArray(routes)) {
        for (const prefix of routes) {
          if (typeof prefix === 'string') {
            apiRoutePrefixes.push({ prefix, routeGroup: appId })
          }
        }
      }
    }

    // Store collections config, events detection, and route prefixes in Nitro runtime config
    nuxt.options.nitro = nuxt.options.nitro || {}
    nuxt.options.nitro.runtimeConfig = nuxt.options.nitro.runtimeConfig || {}
    nuxt.options.nitro.runtimeConfig.croutonCollections = nuxt.options.appConfig?.croutonCollections || {}
    nuxt.options.nitro.runtimeConfig.croutonDevtools = {
      hasEventsPackage,
      apiRoutePrefixes
    }

    // Register operation tracker via Nitro plugin hook
    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.plugins = nitroConfig.plugins || []
      nitroConfig.plugins.push(resolver.resolve('./runtime/server/plugins/operationTracker'))
    })

    // Add server RPC handler for collections endpoint
    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/collections',
      handler: resolver.resolve('./runtime/server-rpc/collections')
    })

    // Add server RPC handlers for operations monitoring
    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/operations',
      handler: resolver.resolve('./runtime/server-rpc/operations')
    })

    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/operations/stats',
      handler: resolver.resolve('./runtime/server-rpc/operationStats')
    })

    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/operations/clear',
      handler: resolver.resolve('./runtime/server-rpc/clearOperations'),
      method: 'post'
    })

    // Add server RPC handlers for API Explorer (Phase 2.2)
    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/endpoints',
      handler: resolver.resolve('./runtime/server-rpc/endpoints')
    })

    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/execute',
      handler: resolver.resolve('./runtime/server-rpc/executeRequest'),
      method: 'post'
    })

    // Add events-specific RPC handlers — ONLY when the events package is present.
    // These handlers statically `import('~~/.../schema')` event-table paths that
    // don't exist in a standard generated app (its schema lives at
    // `server/db/schema`). nitro dev eagerly resolves those literal specifiers at
    // build time, so registering them unconditionally hard-fails `pnpm dev` with
    // ENOENT for any devtools-enabled, events-free app (#799). The runtime handler
    // already no-ops when `!hasEventsPackage`, so gating registration here loses
    // nothing and keeps the broken import out of the bundle entirely.
    if (hasEventsPackage) {
      addServerHandler({
        route: '/__nuxt_crouton_devtools/api/events',
        handler: resolver.resolve('./runtime/server-rpc/events')
      })

      addServerHandler({
        route: '/__nuxt_crouton_devtools/api/events/health',
        handler: resolver.resolve('./runtime/server-rpc/eventsHealth')
      })
    }

    // Add system operations RPC handlers (D1: System Ops tab)
    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/system-operations',
      handler: resolver.resolve('./runtime/server-rpc/systemOperations')
    })

    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/system-operations/clear',
      handler: resolver.resolve('./runtime/server-rpc/clearSystemOperations'),
      method: 'post'
    })

    // Add generation history RPC handler (D3: Generators tab)
    addServerHandler({
      route: '/__nuxt_crouton_devtools/api/generation-history',
      handler: resolver.resolve('./runtime/server-rpc/generationHistory')
    })

    // Serve the static HTML client app
    addServerHandler({
      route: '/__nuxt_crouton_devtools',
      handler: resolver.resolve('./runtime/server-rpc/client')
    })

    // Register custom DevTools tab
    addCustomTab(() => ({
      name: 'crouton',
      title: 'Crouton',
      icon: 'carbon:data-table',
      view: {
        type: 'iframe',
        src: '/__nuxt_crouton_devtools'
      }
    }))

    // Inject Data Browser route into main app (Phase 3)
    nuxt.hook('pages:extend', (pages) => {
      pages.push({
        name: 'crouton-devtools-data-browser',
        path: '/__crouton_devtools/data/:collection',
        file: resolver.resolve('./runtime/pages/data-browser.vue')
      })
    })
  }
})
