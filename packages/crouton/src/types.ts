/**
 * AI feature configuration options
 */
export interface CroutonAIOptions {
  /**
   * Default AI model to use for translations, completions, etc.
   * Examples: 'gpt-4o-mini', 'claude-sonnet-4-20250514'
   * @default 'gpt-4o-mini'
   */
  defaultModel?: string

  /**
   * Default AI provider
   * Auto-detected from model name if not specified
   */
  defaultProvider?: 'openai' | 'anthropic'
}

/**
 * Collection definition for code generation
 */
export interface CroutonCollectionConfig {
  name: string
  fieldsFile?: string
  fields?: Record<string, any>
  sortable?: boolean
  translatable?: boolean
  hierarchy?: {
    enabled: boolean
    parentField?: string
    orderField?: string
    pathField?: string
    depthField?: string
  }
  seed?: boolean | { count?: number }
  collab?: boolean
}

/**
 * Target layer configuration
 */
export interface CroutonTargetConfig {
  layer: string
  collections: string[]
}

/**
 * Unified crouton.config.js configuration
 * Single source of truth for both CLI generation and runtime features
 */
/**
 * Locale definition — either a simple code string or a full locale object
 */
export interface CroutonLocaleObject {
  code: string
  name?: string
  file?: string
}

export interface CroutonConfig {
  /**
   * Feature flags for runtime (which packages to enable)
   * Used by 'crouton config' CLI command and the module
   */
  features?: CroutonOptions

  /**
   * Supported locales for i18n
   * Accepts ISO codes (e.g. 'en') or objects with code/name/file.
   * @default ['en']
   */
  locales?: (string | CroutonLocaleObject)[]

  /**
   * Default locale code
   * @default 'en'
   */
  defaultLocale?: string

  /**
   * Collections to generate (used by CLI)
   */
  collections?: CroutonCollectionConfig[]

  /**
   * Layer targets for collections (used by CLI)
   */
  targets?: CroutonTargetConfig[]

  /**
   * Database dialect
   * @default 'sqlite'
   */
  dialect?: 'sqlite' | 'pg'

  /**
   * Generation flags (used by CLI)
   */
  flags?: {
    noTranslations?: boolean
    force?: boolean
    dryRun?: boolean
    autoRelations?: boolean
  }

  /**
   * Seed data configuration
   */
  seed?: {
    defaultCount?: number
    defaultTeamId?: string
  }
}

/**
 * Feature options for enabling/disabling Crouton packages.
 *
 * Source of truth for available features: each package's `crouton.manifest.ts`.
 * The feature key is derived from the manifest ID (kebab → camelCase):
 *   'crouton-mcp-toolkit' → mcpToolkit
 *
 * This explicit interface is kept for IDE autocomplete and documentation.
 * The runtime mapping in module.ts is driven by manifest discovery.
 */
export interface CroutonOptions {
  /**
   * API prefix for all collection endpoints
   * @default '/api'
   */
  apiPrefix?: string

  /**
   * Default page size for collection queries
   * @default 20
   */
  defaultPageSize?: number

  // ═══════════════════════════════════════════════════════════════════════════
  // Core Add-ons (bundled, enabled by default)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Authentication with Better Auth, teams, passkeys, 2FA
   * @default true
   */
  auth?: boolean

  /**
   * Admin dashboard for team/user management
   * @default true
   */
  admin?: boolean

  /**
   * Multi-language support with DB-backed translations
   * @default true
   */
  i18n?: boolean

  /**
   * Deterministic layout engine (editor, renderer, default-layout pass,
   * placeable blocks, layout_configs storage). Default-on, like auth/admin/i18n.
   * @default true
   */
  layout?: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // Optional Add-ons (disabled by default)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * TipTap rich text editor
   * @default false
   */
  editor?: boolean

  /**
   * Vue Flow graph visualization
   * @default false
   */
  flow?: boolean

  /**
   * Media library and asset management
   * @default false
   */
  assets?: boolean

  /**
   * Mapbox integration
   * @default false
   */
  maps?: boolean

  /**
   * AI/LLM integration with Vercel AI SDK
   * Pass `true` to enable with defaults, or an object to configure
   * @default false
   * @example
   * ai: true  // Uses gpt-4o-mini by default
   * ai: { defaultModel: 'claude-sonnet-4-20250514' }  // Use Claude
   */
  ai?: boolean | CroutonAIOptions

  /**
   * Email with Vue Email and Resend
   * @default false
   */
  email?: boolean

  /**
   * Audit trail and event tracking
   * @default false
   */
  events?: boolean

  /**
   * Real-time collaboration with Yjs
   * @default false
   */
  collab?: boolean

  /**
   * CMS pages system
   * @default false
   */
  pages?: boolean

  /**
   * MCP Toolkit - expose collections to AI assistants via Model Context Protocol
   * @default false
   */
  mcpToolkit?: boolean

  /**
   * Nuxt DevTools integration
   * @default true in development, false in production
   */
  devtools?: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // Mini-Apps (disabled by default)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Booking system for appointments and reservations
   * @default false
   */
  bookings?: boolean

  /**
   * Point of Sale system
   * @default false
   */
  sales?: boolean
}

declare module '@nuxt/schema' {
  interface NuxtConfig {
    crouton?: CroutonOptions
  }
  interface NuxtOptions {
    crouton?: CroutonOptions
  }
  interface PublicRuntimeConfig {
    crouton?: {
      apiPrefix: string
      defaultPageSize: number
    }
  }
}
