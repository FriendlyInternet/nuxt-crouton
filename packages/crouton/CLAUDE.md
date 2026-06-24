# CLAUDE.md - @fyit/crouton

## Package Purpose

Unified Nuxt module that aggregates all Crouton packages into a single entry point with opt-in features. This is the main package users install to use the Crouton ecosystem. It automatically includes core features (auth, admin, i18n) and allows enabling optional add-ons via configuration.

## Key Files

| File | Purpose |
|------|---------|
| `src/module.ts` | Nuxt module entry point, adds layers based on config |
| `src/types.ts` | `CroutonOptions` type definition |
| `build.config.ts` | Unbuild configuration |

## Architecture

```
@fyit/crouton (this module)
    │
    ├── Always includes:
    │   └── @fyit/crouton-core (base CRUD layer)
    │
    ├── Core add-ons (enabled by default):
    │   ├── @fyit/crouton-auth (authentication)
    │   ├── @fyit/crouton-admin (admin dashboard)
    │   ├── @fyit/crouton-i18n (translations)
    │   └── @fyit/crouton-layout (deterministic layout engine)
    │
    ├── Optional add-ons (disabled by default):
    │   ├── @fyit/crouton-editor (TipTap)
    │   ├── @fyit/crouton-flow (Vue Flow)
    │   ├── @fyit/crouton-assets (media library)
    │   ├── @fyit/crouton-maps (Mapbox)
    │   ├── @fyit/crouton-ai (LLM integration)
    │   ├── @fyit/crouton-email (Vue Email)
    │   ├── @fyit/crouton-events (audit trail)
    │   ├── @fyit/crouton-collab (real-time)
    │   ├── @fyit/crouton-pages (CMS)
    │   └── @fyit/crouton-devtools (dev only)
    │
    └── Mini-apps (disabled by default):
        ├── @fyit/crouton-bookings
        └── @fyit/crouton-sales
```

## Configuration

Configuration is unified in `crouton.config.js` - single source of truth for both features and collection generation.

### Unified Config (Recommended)

```javascript
// crouton.config.js
export default {
  // Feature flags - which packages to enable
  features: {
    // Core (enabled by default): auth, admin, i18n
    editor: true,     // TipTap rich text
    pages: true,      // CMS pages
    // bookings: true // Booking system
  },

  // Collection generation (used by CLI)
  collections: [
    { name: 'products', fieldsFile: './schemas/products.json' }
  ],
  targets: [
    { layer: 'shop', collections: ['products'] }
  ],
  dialect: 'sqlite'
}
```

```typescript
// nuxt.config.ts - simplified, reads from crouton.config.js
import { getCroutonLayers } from '@fyit/crouton'

export default defineNuxtConfig({
  extends: [
    ...getCroutonLayers(),  // Auto-reads from crouton.config.js
    './layers/shop'         // Your generated layers
  ],
  modules: ['@fyit/crouton', '@nuxthub/core', '@nuxt/ui'],
  hub: { db: 'sqlite' }
})
```

### Feature Options

| Feature | Default | Description |
|---------|---------|-------------|
| `auth` | `true` | Better Auth with teams, passkeys, 2FA |
| `admin` | `true` | Admin dashboard |
| `i18n` | `true` | Multi-language support |
| `layout` | `true` | Deterministic layout engine (editor, renderer, default-layout pass, blocks, `layout_configs`) |
| `editor` | `false` | TipTap rich text |
| `flow` | `false` | Vue Flow graphs |
| `assets` | `false` | Media library |
| `maps` | `false` | Mapbox integration |
| `ai` | `false` | AI/LLM integration |
| `email` | `false` | Email with Resend |
| `events` | `false` | Audit trail |
| `collab` | `false` | Real-time collaboration |
| `pages` | `false` | CMS pages |
| `bookings` | `false` | Booking system |
| `sales` | `false` | Point of Sale |

### Alternative: Inline Options

You can still pass options directly if you don't want a config file:

```typescript
// nuxt.config.ts
import { getCroutonLayers } from '@fyit/crouton'

export default defineNuxtConfig({
  extends: getCroutonLayers({ editor: true, pages: true }),
  modules: ['@fyit/crouton']
})
```

## How It Works

1. `getCroutonLayers()` loads `crouton.config.js` and reads the `features` section
2. Returns array of package names based on enabled features
3. These are added to `extends` in nuxt.config.ts
4. Module also reads the same config at setup time
5. Each layer brings its own composables, components, and server utilities
6. Layers are resolved by Nuxt's layer system, allowing overrides

**Config priority**: `nuxt.config.ts crouton:` options override `crouton.config.js features`

## Packages vs Generated Layers (IMPORTANT)

Mini-app packages like `@fyit/crouton-bookings` and `@fyit/crouton-pages` provide **UI components and navigation**, but they need **generated layers for the data layer** (database schema, APIs).

### What Each Provides

| Layer Type | Provides | Examples |
|------------|----------|----------|
| **Packages** (via features) | UI components, admin pages, navigation (`croutonApps`), composables, i18n | `@fyit/crouton-bookings`, `@fyit/crouton-pages` |
| **Generated layers** (via CLI) | Database schema, API endpoints, collection configs, types | `./layers/bookings`, `./layers/pages` |

### Correct Setup Pattern

```javascript
// crouton.config.js
export default {
  features: {
    editor: true,
    bookings: true,  // Enables @fyit/crouton-bookings (UI + navigation)
    pages: true,     // Enables @fyit/crouton-pages (UI + navigation)
  },
  collections: [
    { name: 'locations', fieldsFile: './schemas/location.json' },
    { name: 'bookings', fieldsFile: './schemas/booking.json' },
    { name: 'pages', fieldsFile: './schemas/pages.json', hierarchy: true }
  ],
  targets: [
    { layer: 'bookings', collections: ['locations', 'bookings'] },
    { layer: 'pages', collections: ['pages'] }
  ]
}
```

```typescript
// nuxt.config.ts
import { getCroutonLayers } from '@fyit/crouton'

export default defineNuxtConfig({
  extends: [
    ...getCroutonLayers(),  // Includes @fyit/crouton-bookings, @fyit/crouton-pages
    './layers/bookings',    // Generated data layer (schema + APIs)
    './layers/pages'        // Generated data layer (schema + APIs)
  ],
  modules: ['@fyit/crouton', '@nuxthub/core', '@nuxt/ui'],
  hub: { db: 'sqlite' }
})
```

### Why Both Are Needed

- **Without packages**: Collections appear under generic "Collections" dropdown in admin sidebar
- **With packages**: Collections get dedicated top-level navigation (e.g., "Bookings" section with sub-items)
- **Without generated layers**: No database tables or API endpoints
- **With generated layers**: Full CRUD functionality with your custom schema

## Runtime Config

The module sets these runtime config values:

```typescript
// Accessible via useRuntimeConfig()
runtimeConfig.public.crouton = {
  apiPrefix: '/api',
  defaultPageSize: 20
}
```

## Common Tasks

### Check enabled features (dev mode)

Console logs enabled features on startup:
```
🍞 crouton ✓ Enabled features: core, auth, admin, i18n, editor
```

### Add a new feature package

1. Create the feature package in `packages/crouton-{name}/`
2. Add option to `CroutonOptions` in `src/types.ts`
3. Add layer in `src/module.ts` setup function
4. Update defaults in module definition

### Override a feature

Create same-named files in your app's directories. Nuxt's layer system will use your version over the package's.

## Types

```typescript
interface CroutonOptions {
  // Global settings
  apiPrefix?: string           // '/api'
  defaultPageSize?: number     // 20

  // Core add-ons (default: true)
  auth?: boolean
  admin?: boolean
  i18n?: boolean

  // Optional add-ons (default: false)
  editor?: boolean
  flow?: boolean
  assets?: boolean
  maps?: boolean
  ai?: boolean
  email?: boolean
  events?: boolean
  collab?: boolean
  pages?: boolean
  devtools?: boolean          // Auto-detect in dev

  // Mini-apps (default: false)
  bookings?: boolean
  sales?: boolean
}
```

## Dependencies

- **Core dep**: `@nuxt/kit` (for module definition)
- **Peer dep**: `nuxt ^4.0.0`
- **Includes at runtime**: Various `@fyit/crouton-*` packages based on config

## Testing

```bash
pnpm build        # Build module
npx nuxt typecheck # Verify types
```

## Naming Conventions

- Module config key: `crouton`
- Package scope: `@fyit/crouton*`
- Layer packages: `@fyit/crouton-{feature}`
