# TypeScript Checking Guide

## How It Works

```bash
pnpm typecheck
```

This runs `pnpm -r --filter './apps/*' typecheck`, which executes `nuxt typecheck` inside each app directory. Currently checks the `apps/*` apps: **fanfare**, **triage**, **velo** (the docs site lives at top-level `docs/`, outside the filter — it has its own `pnpm --filter @crouton/docs typecheck`).

The scope line reports only a handful of the monorepo’s ~50 workspace entries because only the `apps/*` projects match the filter. Packages are Nuxt layers — they don't have their own typecheck script. They're checked transitively when the apps that extend them are checked.

### Important

- **Always run from repo root**: `pnpm typecheck`
- **Never run `npx nuxt typecheck` from root** — it has no Nuxt app context and produces thousands of false positives
- **Apps are checked sequentially** — if the first app fails, subsequent apps won't run. Fix errors in order.
- **To check a single app**: `cd apps/velo && npx nuxt typecheck`

## Common Error Patterns

### 1. Drizzle ORM Overload Mismatches (TS2769)

**Cause**: Duplicate `drizzle-orm` versions in `node_modules` produce incompatible private `SQLiteColumn` types. Affects `eq()`, `gte()`, `lte()`, `ne()`, `inArray()`, `desc()`, `asc()`, `sum()`, `.leftJoin()`, `.groupBy()`, `.from()`.

**Fix**: Cast the first column argument `as any`:

```typescript
// Before
eq(users.id, someValue)

// After
eq(users.id as any, someValue)
```

For `inArray`, also assert the array is defined:

```typescript
inArray(table.column as any, chunks[0]!)
```

For complex queries with many drizzle errors, cast the entire `db` call:

```typescript
const result = await (db as any)
  .select()
  .from(table)
  .where(eq(table.id, id))
```

### 2. `useFetch` with Computed Null URLs (TS2769)

**Cause**: `useFetch` doesn't accept `string | null` from a computed URL factory.

**Fix**: Cast the null return:

```typescript
// Before
const url = computed(() => teamId ? `/api/teams/${teamId}/data` : null)

// After
const url = computed(() => teamId ? `/api/teams/${teamId}/data` : null as any)
```

### 3. `globalThis` Cast (TS2352)

**Cause**: TypeScript won't allow direct cast from `typeof globalThis` to `Record<string, Set<string>>`.

**Fix**: Use intermediate `unknown` cast:

```typescript
// Before (fails)
(globalThis as Record<string, Set<string>>)

// After
(globalThis as unknown as Record<string, Set<string>>)
```

This appears in many `nuxt.config.ts` files for the dedup guard pattern.

### 4. Mapbox `Map$1` Type Mismatch

**Cause**: Mapbox GL JS map instance type differs between `nuxt-mapbox` and `mapbox-gl` packages.

**Fix**: Cast map refs `as any` when passing to components:

```vue
<CroutonMapsMarker :map="map as any" :position="position" />
```

### 5. TipTap Editor Command Types

**Cause**: Custom TipTap extensions add commands that aren't in the base `Commands` type.

**Fix**: Cast commands `as any`:

```typescript
(editor.commands as any).triggerTranslationSuggestion()
```

### 6. Nitro Auto-Import Not Found

**Cause**: Functions like `requireUserSession`, `createAIProvider` are auto-imported by Nitro at build time but not visible to TypeScript in layer packages.

**Fix**: Add `@ts-expect-error` comment:

```typescript
// @ts-expect-error Nitro auto-import from crouton-auth
const session = await requireUserSession(event)
```

### 7. Possibly Undefined Array Access (TS18048)

**Cause**: TypeScript's `noUncheckedIndexedAccess` flags `array[0]` as possibly undefined.

**Fix**: Add non-null assertion:

```typescript
// Before
const first = items[0].name

// After
const first = items[0]!.name
```

### 8. Zod 4 API Changes

**Cause**: Zod 4 renamed `required_error` to `error` in schema options.

**Fix**:

```typescript
// Before (Zod 3)
z.string({ required_error: 'Name is required' })

// After (Zod 4)
z.string({ error: 'Name is required' })
```

### 9. Generated Collection Form `ref` Type Mismatch

**Cause**: `initialValues` spread object doesn't perfectly match the form data type due to optional/date fields.

**Fix**: Cast in the `ref()` call:

```typescript
const state = ref<MyFormData & { id?: string | null }>(initialValues as any)
```

### 10. Callback Implicit `any` (TS7006)

**Cause**: Array method callbacks without type annotations in strict mode.

**Fix**: Add `: any` type annotation:

```typescript
// Before
.filter((item) => item.active)

// After
.filter((item: any) => item.active)
```

## Root Cause: Duplicate drizzle-orm

The majority of errors (~40%) stem from duplicate `drizzle-orm` versions in `node_modules`. Different packages resolve slightly different versions, producing incompatible internal types. The `as any` casts are a pragmatic workaround — the proper fix would be deduplicating drizzle-orm via `pnpm.overrides` in the root `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "drizzle-orm": "^0.38.0"
    }
  }
}
```

This hasn't been applied yet because it may introduce runtime regressions.

## Maintaining Zero Errors

1. Run `pnpm typecheck` after every code change
2. When adding new drizzle queries, proactively cast column args `as any`
3. When adding `useFetch` with conditional URLs, cast null returns
4. When using cross-package component props (maps, editor), expect type mismatches and cast
5. Generated collection forms may need `as any` on `ref()` initialization
