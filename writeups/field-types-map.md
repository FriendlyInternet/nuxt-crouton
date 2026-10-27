# Field-type definitions: where they live, where they disagree, and the single source

Research for #2739 (epic #2734). No code changes. Line numbers are against `epic/2734-cli-audit-smaller` at the time of writing.

## TL;DR

The single source already exists and is already half-wired: **`fieldTypes` in `packages/crouton-core/crouton.manifest.ts:12-24`**, loaded by `getTypeMapping()` / `getFieldTypeRegistry()` in `packages/crouton-cli/lib/utils/manifest-loader.ts` and attached to every field by `loadFields()` (`lib/utils/load-fields.ts:61-73`). Roughly half the CLI generators still ignore the loaded `field.zod / field.tsType / field.default / field.component` and re-declare their own switch. Only crouton-core declares `fieldTypes` today (`crouton-assets` only *detects* `image`/`file`, `crouton.manifest.ts:60`). The migration is to make the manifest entry carry the missing columns and delete the local copies, one generator at a time.

## 1. Where a field type (or a mapping per type) is defined

All paths under `packages/`. "Reads" = who consumes it.

### The declared source

| File:line | Types known | What it maps | Reads |
|---|---|---|---|
| `crouton-core/crouton.manifest.ts:12-24` | string, text, number (alias integer), decimal, boolean, date (alias datetime), json, repeater, array, reference, image, file (12) | label, icon, description, `db`, `drizzle`, `zod`, `tsType`, `defaultValue`, `component`, `meta`, `aliases` | manifest-loader (all rows below marked "via loader") |
| `crouton-core/shared/manifest.ts:33` (type), `:156` (`detects.fieldTypes`) | – | the `FieldTypeDefinition` shape; `detects.fieldTypes` is a list of type names a package reacts to | manifest-loader |
| `crouton-cli/lib/utils/manifest-loader.ts:154-176` `getFieldTypeRegistry`; `:180` `getCanonicalFieldTypes`; `:299-330` `getTypeMapping` | whatever manifests declare, aliases expanded, `canonical` added (#285) | flat registry / `{db, drizzle, zod, default, tsType, canonical, component}` | `generate-collection.ts:1832,1908` -> `loadFields`; crouton-mcp |
| `crouton-cli/lib/utils/load-fields.ts:61-73` | via loader | stamps `field.zod/default/tsType/component` onto each field; `:83-89` does the same for repeater sub-properties | every generator that reads `field.*` |

### Local copies in the CLI (the duplicates)

| File:line | Types known | What it maps | Reads / status |
|---|---|---|---|
| `lib/generators/database-schema.ts:72-85` | boolean, number, decimal, date, json, repeater, array, + `dependsOn`/`slotButtonGroup`; everything else -> `text` | **SQLite drizzle column** (`integer`, `real`, `integer({mode:'timestamp'})`, `jsonColumn`) | generator only; ignores manifest `drizzle`/`db` |
| `lib/generators/types.ts:76-85` | string, text, number, decimal, boolean, date, json, array | TS type | generator only; **identical to the next two** |
| `lib/generators/composable.ts:48-58` | same 8 as `types.ts` (zod strings) | zod string | generator only; duplicates manifest `zod` which is already on `field.zod` |
| `lib/generators/field-components.ts:358-365` | same 8 | TS type for generated field components | generator only; duplicate of `types.ts` |
| `lib/generators/field-components.ts:301` | text vs other | control for repeater sub-properties | should use `typeMapping[canonical].component` (as `load-fields.ts:88` already does) |
| `lib/generators/form-component.ts:230,263,272,308` | array, json, image | data-shape specials + image `:crop`. The generic control comes from `field.component` (see comment `:251-256`, #2286) | **already on the manifest**; the specials are legitimately value-shape logic |
| `lib/generators/list-component.ts:60-69,122` | array, date, boolean, repeater | cell renderers | generator only (presentation, not a type definition) |
| `lib/generators/collection-seed-fixture.ts:46-62` | number, decimal, boolean, date, json, array, image, file, text; default string | sample values | generator only; **no `repeater`, no `reference`** (falls to a string) |
| `lib/generators/collection-test.ts:37` | date only | ISO sample for test bodies | generator only |
| `lib/generators/database-queries.ts:276,281,308` | repeater, json, array | parse/default handling | generator only |
| `lib/generators/api-endpoints.ts:93` | date | date coercion | generator only |
| `lib/utils/helpers.ts:100-110` | string, text, number, decimal, boolean, date, json, repeater, array | drizzle-seed generator expressions | generator only; **no `reference/image/file`** |
| `lib/generate-collection.ts:439-477` | date, string, text, number, decimal, boolean, json, repeater | request-body zod, overriding `field.zod` | generator only; duplicates `composable.ts:48` for the API side |
| `lib/generate-collection.ts:579` | json | nullable TS type | generator only |
| `lib/generate-collection.ts:765` | string, text, **richText** | translatable-field detection | `richText` is not a known type anywhere else |
| `lib/generators/seed-data.ts:25-30` | – | `AUTO_FIELDS` literal list (auto + hierarchy) | **duplicates `lib/utils/system-fields.ts`**, which is headed "The ONE enumeration" (`:1`) |
| `lib/generators/collection-test.ts:20`, `collection-seed-fixture.ts:15` | – | `AUTO_FIELDS` built from `system-fields` | correct (consume `system-fields`) |
| `crouton-core/crouton.manifest.ts:26-29` | – | `autoGeneratedFields` (7 names), another copy of the system-field list | manifest-loader `getAutoGeneratedFields`; crouton-mcp |

### Other consumers outside the CLI generators

| File:line | Types known | What | Status |
|---|---|---|---|
| `crouton-mcp/src/utils/field-types.ts:20-33` | the same 12 (no aliases/`component`) | `FALLBACK_FIELD_TYPES`, hand copy of the manifest | used only if the loader fails; `loadFieldTypes()` `:49-72` otherwise overwrites it from `getTypeMapping()` via jiti |
| `crouton-mcp/src/utils/field-types.ts:35-37` | – | `FALLBACK_AUTO_GENERATED` | copy of manifest `autoGeneratedFields` |
| `crouton-mcp/src/tools/validate-schema.ts:7,83,88-95` | VALID_FIELD_TYPES + decimal `meta.precision/scale` check | validation | reads loaded types (good); decimal rule is local |
| `crouton-mcp/src/tools/init-schema.ts:41,76,80,183` | decimal, repeater | example schemas | static examples |
| `crouton-core/app/components/Detail.vue:225-229,326-329` | number, decimal (and others) | runtime display formatting | runtime reads `field.type` directly; no import from the manifest |
| `crouton-core/app/types/*.ts` | none | no field-type union exists; `type` is `string` | nothing to reconcile, but nothing enforces valid names either |
| `crouton-cli/lib/generate-collection.ts:197` | image/file via `assetsDetector.fieldTypes` | package-detection | uses manifest `detects` (good) |

## 2. Where they disagree today

1. **Manifest `drizzle`/`db` vs the generated column.** The manifest says `decimal -> 'decimal'`, `date -> 'timestamp'`, `boolean -> 'boolean'`, `json -> 'json'`. `database-schema.ts:72-85` emits SQLite `real`, `integer({mode:'timestamp'})`, `integer({mode:'boolean'})`, `jsonColumn`. The manifest `drizzle` column is therefore **not read by the generator** and describes no real output (the MCP `drizzle` field shows the same fiction). The dialect is hard-wired SQLite.
2. **Three identical 8-entry maps omit 4 known types.** `types.ts:76`, `composable.ts:48`, `field-components.ts:358` lack `repeater`, `reference`, `image`, `file`. They silently fall to a default (`string`/`z.string()`), whereas the manifest says `repeater -> any[]` / `z.array(z.any())`. Repeater is patched elsewhere (`generate-collection.ts:462`, `composable.ts:116,188`), so the type is correct only by accident of a second special case.
3. **Alias handling.** `datetime` and `integer` resolve to `canonical` in `load-fields.ts:61`, so generators see canonical names, but `helpers.ts:100` and `collection-seed-fixture.ts:46` are keyed on canonical names only and would miss an alias if they ever got a raw one (#285 was exactly this bug).
4. **Seed value coverage differs per generator.** `helpers.ts` (drizzle-seed) covers repeater but not reference/image/file; `collection-seed-fixture.ts` covers image/file but not repeater/reference; neither is derived from the manifest.
5. **Seed `default` for `date`.** Manifest default is `'null'`; `database-schema.ts:78` emits `$default(() => new Date())`; seed fixture emits unix seconds. Three different "default date" notions.
6. **`AUTO_FIELDS` has two sources.** `seed-data.ts:25` is a literal list; `system-fields.ts` is declared the one enumeration; the manifest has a third list (`autoGeneratedFields`, without the hierarchy group `parentId/path/depth/order`, which sits in `reservedFieldNames`).
7. **`richText`** is tested in `generate-collection.ts:765` but is not a manifest type (`crouton-editor` declares none), so it is dead or unreachable through `loadFields` validation.
8. **MCP fallback is a stale hand copy** (no `component`, no aliases, no `meta`); it can drift from the manifest, and it is only reached on loader failure, which makes drift invisible.
9. **Runtime vs generator.** `Detail.vue` and the generated list/form each re-decide per-type presentation; none consult the manifest.

## 3. Proposal: one source, and the migration order

**Source: `fieldTypes` in package manifests (today only `crouton-core`), read through `getTypeMapping()` in `manifest-loader.ts`.** Packages can add types (`crouton-assets`, `crouton-editor`) without touching the CLI. `system-fields.ts` stays the single source for system *columns* (not types); the manifest `autoGeneratedFields` should be generated from or checked against it.

Extend `FieldTypeDefinition` (`crouton-core/shared/manifest.ts`) with the columns the local switches actually encode, so a generator never needs `if (type === ...)` for a mapping:

- `sqlite: { column: 'integer' | 'real' | 'text' | 'json', mode?: 'boolean' | 'timestamp', default?: string }` (and either drop or document `db`/`drizzle` as non-SQLite informational, per finding 1)
- `seed: { drizzleSeed: string, fixture: string }`
- `testSample: string`

`loadFields` then stamps these onto `field.*` exactly as it does `zod/tsType/default/component` today.

### Follow-up issues, in order (smallest/safest first)

1. **Drop the three duplicate maps** - `types.ts:76`, `composable.ts:48`, `field-components.ts:358`: use `field.tsType`/`field.zod`/`typeMapping[canonical].tsType` that `loadFields` already provides. No manifest change; fixes the repeater/image/file gap. Test: golden-output diff on the fixtures, expect only repeater/reference/image/file cells to change (to correct values). Size S.
2. **One system-field list** - `seed-data.ts:25` imports `system-fields.ts`; add a unit test asserting manifest `autoGeneratedFields` is a subset of `AUTO_GENERATED_FIELDS`; MCP fallback imports rather than copies. Size S.
3. **`generate-collection.ts:439-477` request-body zod** - derive from `field.zod` with the existing `.coerce.date()` and nullish rules kept as modifiers. Size S/M.
4. **Seed/test samples** - add `seed`/`testSample` to the manifest, delete `helpers.ts:100` typeMap, `collection-seed-fixture.ts:46` switch and `collection-test.ts:37`. Size M.
5. **`database-schema.ts` column mapping** - add the `sqlite` column descriptor to the manifest and read it; fix/rename the misleading `drizzle`/`db` strings. Highest risk (affects migrations of existing apps): needs the schema sign-off gate and a fixture diff. Size M.
6. **MCP** - make the fallback a build-time snapshot of the manifest (generated file + test that it equals `getTypeMapping()`), or remove it and fail loudly. Size S.
7. **Decide `richText`** (add as a type from `crouton-editor`'s manifest, or delete the dead branch at `generate-collection.ts:765`). Size XS, owner call on intent.
8. **Out of scope on purpose:** `list-component.ts`, `form-component.ts` specials, `database-queries.ts`, `api-endpoints.ts` and `Detail.vue` are presentation/serialisation behaviour keyed on value shape, not type definitions; leave them.

Order rationale: 1-2 are pure deletions with no manifest-schema change; 3-4 add manifest columns additively; 5 is the only step that changes emitted artifacts for existing consumers, so it goes last and behind a gate.
