import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { defineNuxtModule, createResolver, addImports, addPlugin, addServerHandler } from '@nuxt/kit'
import { createSourceStampTransform } from './runtime/transform/sourceStamp'
import { normalizeChangelog, type ChangelogEntry } from './runtime/tools/changelog-data'
import { composePlan, type ComposedPlan } from './runtime/tools/plan-data'

/**
 * @fyit/crouton-feedback — in-page feedback toolkit for any Nuxt UI app.
 *
 * Wired: the glasses launcher + tool registry + Console (eruda) tool (#962), the
 * Annotate tool + source-stamp transform + the `/api/_feedback` dispatcher (#963),
 * the four sinks (#964), and the sink-selection config surface below (#965).
 *
 * The module deliberately depends only on Nuxt + Nuxt UI 4 — NOT on
 * @fyit/crouton-core — so any Nuxt UI app can install it.
 */
export interface FeedbackModuleOptions {
  /**
   * Force the toolkit on regardless of the dev/env gate. Set by a host module
   * that installs this one (e.g. @fyit/crouton-devtools) so the launcher appears
   * under the host's own gate. When unset, the gate is `dev ||
   * NUXT_PUBLIC_CROUTON_FEEDBACK=true`.
   */
  enabled?: boolean
  /**
   * Where a sent annotation lands. Server-side only — credentials/URLs never
   * reach the client bundle. Every field is overridable at runtime by its
   * `NUXT_CROUTON_FEEDBACK_*` env var (preferred for secrets).
   */
  feedback?: {
    /** Built-in destination. Default `'webhook'`. (`NUXT_CROUTON_FEEDBACK_SINK`) */
    sink?: 'webhook' | 'slack' | 'discord' | 'github'
    /** `webhook` sink: generic JSON POST target. (`…_WEBHOOK_URL`) */
    webhookUrl?: string
    /** `slack` sink: Slack incoming-webhook URL. (`…_SLACK_URL`) */
    slackUrl?: string
    /** `discord` sink: Discord webhook URL. (`…_DISCORD_URL`) */
    discordUrl?: string
    /** `github` sink: comment as a GitHub App (preferred) or PAT fallback. */
    github?: {
      /** App id. (`…_GITHUB_APP_ID`) */
      appId?: string
      /** App private key PEM — prefer the env var, don't commit it. (`…_GITHUB_APP_PRIVATE_KEY`) */
      privateKey?: string
      /** Installation id. (`…_GITHUB_APP_INSTALLATION_ID`) */
      installationId?: string
      /** Interim PAT, honoured only when App creds are absent. (`…_GITHUB_TOKEN`) */
      token?: string
      /** "owner/repo". (`…_GITHUB_REPOSITORY`) */
      repository?: string
      /** Issue or PR number to comment on. (`…_GITHUB_PR`) */
      pr?: string | number
    }
  }
  /**
   * The **Changelog** tool — a `vNN`-badged launcher row that opens a version
   * timeline. JSON-first: entries come from a committed `changelog.json`; an
   * optional build-time git stamp fills the current deployed commit. Omit the
   * whole block and the tool simply hides itself (no entries).
   */
  changelog?: {
    /** Inline entries, bypassing file lookup. */
    entries?: ChangelogEntry[]
    /**
     * Path (relative to the app root) to a changelog JSON file. When unset, the
     * module auto-detects `<srcDir>/changelog.json`, `app/changelog.json`, then
     * `changelog.json`.
     */
    path?: string
    /** Commit-link URL template; `{commit}` is replaced with the hash. */
    commitUrlTemplate?: string
    /** Stamp the current git short SHA at build (default true). */
    stampGitCommit?: boolean
  }
  /**
   * The **Plan** tool — a badged launcher row that opens a plan in an overlay,
   * rendered natively with Nuxt UI (no iframe). DATA-first: point it at a plan
   * overlay JSON (phases/increments); its `specSource` (or `specPath`) locates
   * the spec ledger the module joins in. The row badge is the active phase.
   * Omit the whole block and the tool simply hides itself.
   */
  plan?: {
    /** Inline composed plan, bypassing file lookup (mainly for tests). */
    data?: unknown
    /** Path (relative to the app root) to the plan overlay JSON. */
    dataPath?: string
    /**
     * Path (relative to the app root) to the spec-ledger JSON. When unset, the
     * module resolves the plan JSON's own `specSource` relative to it.
     */
    specPath?: string
    /** Overlay title override (else the plan JSON's `title`, else "Plan"). */
    title?: string
  }
}

/** Read + normalize changelog entries from inline options or a JSON file. */
function readChangelogEntries(
  opts: NonNullable<FeedbackModuleOptions['changelog']>,
  rootDir: string,
  srcDir: string
): ChangelogEntry[] {
  if (Array.isArray(opts.entries)) return normalizeChangelog(opts.entries)
  const candidates = opts.path
    ? [resolvePath(rootDir, opts.path)]
    : [
        resolvePath(srcDir, 'changelog.json'),
        resolvePath(rootDir, 'app/changelog.json'),
        resolvePath(rootDir, 'changelog.json')
      ]
  for (const file of candidates) {
    try {
      if (existsSync(file)) return normalizeChangelog(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      // ignore a malformed/unreadable candidate and try the next
    }
  }
  return []
}

/** Read + parse a JSON file, or null when absent/malformed. */
function readJson(file: string): unknown {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // ignore a malformed/unreadable file
  }
  return null
}

/**
 * Compose the Plan tool's data at build: the plan overlay JSON (inline or from a
 * file) joined with its spec ledger (resolved via `specPath`, else the plan
 * JSON's own `specSource` relative to it). Returns the `ComposedPlan` injected
 * into `runtimeConfig.public.croutonPlan`; an empty `phases` when no plan is
 * configured (→ the tool hides itself).
 */
function readPlan(
  opts: NonNullable<FeedbackModuleOptions['plan']>,
  rootDir: string
): ComposedPlan {
  const planRaw = opts.data ?? (opts.dataPath ? readJson(resolvePath(rootDir, opts.dataPath)) : null)

  // The spec ledger: an explicit specPath, else the plan JSON's `specSource`
  // resolved relative to the plan file's directory (that's what it's for).
  let specRaw: unknown = null
  if (opts.specPath) {
    specRaw = readJson(resolvePath(rootDir, opts.specPath))
  } else if (opts.dataPath && planRaw && typeof planRaw === 'object') {
    const specSource = (planRaw as { specSource?: string }).specSource
    if (specSource) {
      specRaw = readJson(resolvePath(dirname(resolvePath(rootDir, opts.dataPath)), specSource))
    }
  }

  const composed = composePlan(planRaw, specRaw)
  return opts.title ? { ...composed, title: opts.title } : composed
}

/** Current short SHA at build; empty string when git is unavailable (e.g. CI). */
function readGitCommit(rootDir: string): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

export default defineNuxtModule<FeedbackModuleOptions>({
  meta: {
    name: '@fyit/crouton-feedback',
    configKey: 'croutonFeedback',
    compatibility: {
      nuxt: '^4.0.0'
    }
  },
  defaults: {},
  setup(options, nuxt) {
    // Enabled when a host module forces it (`options.enabled`), in local dev, or
    // when a build opts in via NUXT_PUBLIC_CROUTON_FEEDBACK=true. The plugins
    // double-check the flag at runtime, so a production build that doesn't set it
    // ships nothing.
    const enabled = options.enabled === true
      || nuxt.options.dev
      || process.env.NUXT_PUBLIC_CROUTON_FEEDBACK === 'true'
    if (!enabled) return

    const resolver = createResolver(import.meta.url)

    // Expose the gate to the client (→ runtimeConfig.public.croutonFeedback),
    // which the plugins re-check before mounting/registering anything.
    nuxt.options.runtimeConfig.public ||= {}
    ;(nuxt.options.runtimeConfig.public as Record<string, unknown>).croutonFeedback = true

    // The registry composable, auto-imported so a tool can register itself.
    addImports({
      name: 'useFeedbackTools',
      from: resolver.resolve('./runtime/composables/useFeedbackTools')
    })

    // Mount the glasses launcher into the host app's <body> context.
    addPlugin({
      src: resolver.resolve('./runtime/plugins/feedback.client'),
      mode: 'client'
    })

    // First registered tool: Console (eruda), lazy-imported on first toggle.
    addPlugin({
      src: resolver.resolve('./runtime/plugins/tools/console.client'),
      mode: 'client'
    })

    // Second tool: Annotate — pin a comment on an element → POST /api/_feedback.
    addPlugin({
      src: resolver.resolve('./runtime/plugins/tools/annotate.client'),
      mode: 'client'
    })

    // Third tool: Changelog — a vNN-badged version timeline. JSON-first data
    // (a committed changelog.json) + an optional build-time git stamp for the
    // current deployed commit, exposed to the client via runtimeConfig.public.
    const cl = options.changelog ?? {}
    ;(nuxt.options.runtimeConfig.public as Record<string, unknown>).croutonChangelog = {
      entries: readChangelogEntries(cl, nuxt.options.rootDir, nuxt.options.srcDir),
      commitUrlTemplate: cl.commitUrlTemplate || '',
      buildCommit: cl.stampGitCommit === false ? '' : readGitCommit(nuxt.options.rootDir)
    }
    addPlugin({
      src: resolver.resolve('./runtime/plugins/tools/changelog.client'),
      mode: 'client'
    })

    // Fourth tool: Plan — a badged launcher row that opens a plan document
    // (self-contained HTML) in an overlay iframe. HTML-first (the ONE renderer
    // stays authoritative); the plan JSON drives the badge + title. Hidden when
    // unconfigured. Exposed to the client via runtimeConfig.public.
    ;(nuxt.options.runtimeConfig.public as Record<string, unknown>).croutonPlan = readPlan(
      options.plan ?? {},
      nuxt.options.rootDir
    )
    addPlugin({
      src: resolver.resolve('./runtime/plugins/tools/plan.client'),
      mode: 'client'
    })

    // Fifth tool: Spec walk — the "does it still work?" facet (#1038). No build
    // data of its own: it reuses the composed plan above (plan ⋈ spec ledger),
    // walks the LIVE behaviours against the running build, and exports the
    // `lgtm <id>` sign-off. Hidden when the app configures no plan.
    addPlugin({
      src: resolver.resolve('./runtime/plugins/tools/specwalk.client'),
      mode: 'client'
    })

    // Build-time source stamping: inject `data-feedback-src="<relative .vue>"`
    // on each component's root element so a click resolves to the owning file.
    // Runs in the Vue compiler, so it survives `nuxt build` (present in the
    // deployed DOM), unlike Vue DevTools' dev-only inspector attribute.
    nuxt.options.vite ||= {}
    const vite = nuxt.options.vite as Record<string, any>
    vite.vue ||= {}
    vite.vue.template ||= {}
    vite.vue.template.compilerOptions ||= {}
    const compilerOptions = vite.vue.template.compilerOptions
    compilerOptions.nodeTransforms = [
      ...(compilerOptions.nodeTransforms || []),
      createSourceStampTransform(nuxt.options.rootDir)
    ]

    // Server dispatcher config, built from module options. Every field is
    // overridable at runtime by its NUXT_CROUTON_FEEDBACK_* env var — Nuxt only
    // maps env onto keys that already exist here, so the empty-string defaults are
    // load-bearing (they make slack/discord/github reachable from env). These live
    // in SERVER runtimeConfig only — never runtimeConfig.public — so no credential
    // or URL ships in the client bundle.
    const fb = options.feedback ?? {}
    const gh = fb.github ?? {}
    ;(nuxt.options.runtimeConfig as Record<string, any>).croutonFeedback = {
      sink: fb.sink || 'webhook',
      webhookUrl: fb.webhookUrl ?? '',
      slackUrl: fb.slackUrl ?? '',
      discordUrl: fb.discordUrl ?? '',
      githubAppId: gh.appId ?? '',
      githubAppPrivateKey: gh.privateKey ?? '',
      githubAppInstallationId: gh.installationId ?? '',
      githubToken: gh.token ?? '',
      githubRepository: gh.repository ?? '',
      githubPr: gh.pr != null ? String(gh.pr) : ''
    }
    addServerHandler({
      route: '/api/_feedback',
      handler: resolver.resolve('./runtime/server/api/feedback.post'),
      method: 'post'
    })
  }
})
