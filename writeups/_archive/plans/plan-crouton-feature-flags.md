> 🗄️ **Archived 2026-11-04 (#3352) — dropped:** never built (no `useCroutonFeatures` in packages/) and no issue tracks it. Historical record, not current guidance.

# Crouton Sub-Package Feature Flags

## Summary

Add a middle layer between package-level toggles (CroutonOptions booleans) and runtime behavior: **sub-package feature flags** declared in manifests, configured per-app, and accessible via a unified composable.

**Motivation**: Crouton has 27 packages and 5+ apps. Package-level toggles exist (`extends` + CroutonOptions booleans), but there's no way to toggle sub-features within a package (e.g. disable redirects in core, disable email in bookings), toggle core UI behaviors (shortcuts, import/export, image crop) per app, or gradually roll out new features to individual apps.

**Approach**: Extend CroutonOptions + manifest configuration into a unified runtime API via `useCroutonFeatures()`.

---

## What Stays

| Layer | Status |
|---|---|
| CroutonOptions boolean toggles for package inclusion | No change |
| `useCroutonApps().hasApp()` for package detection | No change |
| Manifest `configuration` declarations (schema/metadata) | No change (used as defaults source) |
| Existing auth config (`croutonAuth.methods.*`) | No change (bridged, not replaced) |

## What Changes

| File | Change |
|---|---|
| `packages/crouton/src/types.ts` | Allow `boolean \| FeatureConfig` for feature keys, add `core` key |
| `packages/crouton/src/module.ts` | Resolve manifest defaults + app overrides, inject into appConfig |
| `packages/crouton-core/app/composables/useCroutonFeatures.ts` | **New** — client-side `isEnabled()` / `getConfig()` |
| `packages/crouton-core/server/utils/useCroutonFeatures.ts` | **New** — server-side equivalent |
| `packages/crouton-core/shared/features.ts` | **New** — typed feature path union |
| `packages/crouton-core/crouton.manifest.ts` | Add configuration for core toggleable features |
| `packages/crouton-auth/crouton.manifest.ts` | Add configuration for passkeys/twoFactor |
| `packages/crouton-core/modules/manifest-injection.ts` | Include resolved features in appConfig injection |

---

## Design

### 1. CroutonOptions type expansion (backward-compatible)

Change feature keys from boolean to `boolean | FeatureConfig`:

```typescript
// Before
bookings?: boolean

// After
bookings?: boolean | { email?: boolean; bookingModes?: ('slots' | 'inventory')[] }
auth?: boolean | { passkeys?: boolean; twoFactor?: boolean }
```

`true` = enable with defaults. `{ email: true }` = enable with specific sub-features. `false` = disabled entirely.

For core features (always installed), add a separate `features` key at root level:

```typescript
features?: {
  redirects?: boolean     // default: true
  shortcuts?: boolean     // default: true
  imageCrop?: boolean     // default: true
  importExport?: boolean  // default: true
}
```

> **Design decision**: Core behaviors live under `features`, not `core`, because core is always installed — it's not a package toggle. This avoids confusion between "disable a package" and "disable a behavior."

### 2. Build-time resolution in the module

In `module.ts` setup(), after merging options:

1. For each discovered manifest, read its `configuration` section for **defaults**
2. Merge with the app's CroutonOptions (app overrides take precedence)
3. Inject the resolved feature map into `appConfig.crouton.features`

```typescript
// Resolved shape injected at build time:
appConfig.crouton.features = {
  core: { enabled: true, redirects: true, shortcuts: true, imageCrop: true, importExport: true },
  bookings: { enabled: true, email: false, bookingModes: ['slots'] },
  auth: { enabled: true, passkeys: false, twoFactor: true },
  pages: { enabled: true },
  editor: { enabled: false },
}
```

> **Design decision**: Use `appConfig` only, not `runtimeConfig`. These are build-time decisions, not runtime-toggleable. Keeps the mental model simple and avoids env-var divergence. Server code reads from the same appConfig source.

### 3. `useCroutonFeatures()` composable (client + server)

```typescript
export function useCroutonFeatures() {
  const appConfig = useAppConfig()
  const features = computed(() => appConfig.crouton?.features ?? {})

  function isEnabled(path: CroutonFeaturePath): boolean {
    // 'bookings' → check bookings.enabled
    // 'bookings.email' → check bookings.enabled && bookings.email
    // 'core.redirects' → check core.redirects
  }

  function getConfig<T>(path: string): T | undefined { /* dot-path lookup */ }

  return { features, isEnabled, getConfig }
}
```

Server equivalent in `server/utils/` reads from the same appConfig.

### 4. Facade over existing config (critical for auth)

`useCroutonFeatures` acts as a **facade** that knows how to read from package-specific config locations. It does NOT require migrating existing config:

```typescript
// isEnabled('auth.passkeys') internally reads:
// → runtimeConfig.public.crouton.auth.methods.passkeys
// NOT a duplicated config key

// Registry maps feature paths to config locations:
const configBridges: Record<string, () => boolean> = {
  'auth.passkeys': () => runtimeConfig.public.crouton.auth?.methods?.passkeys !== false,
  'auth.twoFactor': () => runtimeConfig.public.crouton.auth?.methods?.twoFactor !== false,
}
```

This avoids two config systems coexisting. New packages use the unified system directly; existing packages are bridged.

### 5. Typed feature paths (DX)

```typescript
export type CroutonFeaturePath =
  | 'core' | 'core.redirects' | 'core.shortcuts' | 'core.imageCrop' | 'core.importExport'
  | 'auth' | 'auth.passkeys' | 'auth.twoFactor'
  | 'bookings' | 'bookings.email' | 'bookings.bookingModes'
  | 'pages' | 'editor' | 'maps' | 'ai' | 'assets' | 'flow'
```

`isEnabled()` accepts `CroutonFeaturePath` for autocomplete but falls back to `string` to avoid hard failures when types drift. Consider generating this from manifest declarations during `nuxt prepare` if maintenance becomes a burden.

### 6. Initial guard points (3 to start)

| Guard point | Location | Behavior when disabled |
|---|---|---|
| Redirects middleware | `crouton-core/server/middleware/redirects.ts` | Skip middleware entirely |
| Shortcuts composable | `useCroutonShortcuts` | No-op, register nothing |
| Import/Export buttons | Admin UI components | Hide buttons via `v-if` |

More guard points added after the pattern is proven.

---

## What NOT to build

- No admin UI for runtime feature toggling (developer config in code only)
- No per-team/per-user feature flags (billing/subscription concern, different system)
- No cross-cutting tag system (package-level toggle handles "disable all AI")
- No build-time tree-shaking based on flags (Nuxt layers handle dead code)
- No database storage of flags
- No runtimeConfig duplication (appConfig only)

---

## Migration Path

Existing config (`croutonAuth.methods.passkeys`, bookings manifest config) continues to work unchanged. The facade reads from both old and new locations. New code uses `useCroutonFeatures()`. Migrate existing checks gradually — no breaking changes.

---

## Rollout Strategy

### PR 1: Core infrastructure + core feature guards
- CroutonOptions type changes
- Module resolution logic
- `useCroutonFeatures()` composable (client + server)
- Core features wired up (redirects, shortcuts, import/export)
- Typed feature paths

### PR 2: Package feature declarations + auth/bookings bridging
- Manifest configuration declarations for priority packages
- Config bridges for auth methods
- Bookings sub-feature reads migrated to unified composable

---

## How to Verify

1. Add `features: { redirects: false }` to triage's config — redirects middleware should skip
2. Add `bookings: { email: true }` to velo's config — `isEnabled('bookings.email')` returns true
3. Confirm `isEnabled('editor')` returns false for apps that don't extend crouton-editor
4. `pnpm typecheck` passes across all apps
5. Dev console logs resolved features on startup

---

## Open Questions

1. **Should `getConfig()` return typed values?** Currently returns `T | undefined` with manual generic — could generate per-path return types from manifests.
2. **Generate `CroutonFeaturePath` from manifests?** Manual maintenance is fine initially, but could drift. A `nuxt prepare` hook could generate it.
3. **Should disabled features strip server routes?** Currently only guards middleware/UI. Removing API routes for disabled features would be cleaner but adds complexity.
