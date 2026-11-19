# CLAUDE.md - @fyit/crouton-catalog

## Package Purpose

The shared team product list: one `catalogProducts` collection that says **what a team
offers**. Bookings extends it (a location will give a product a stock); the sales package
can later give the same products a price. A product belongs to exactly one team.

The layer name is `catalog` (unique across packages — `crouton` is taken by crouton-assets),
the app id is `products` (`useCroutonApps().hasApp('products')`).

## Key Files

| File | Purpose |
|------|---------|
| `collections/products/` | The `catalogProducts` collection, owned end to end: `server/database/{schema,queries}.ts` (`catalog_products`), CRUD routes `server/api/teams/[id]/catalog-products/*`, `types.ts`, `app/composables/useCatalogProducts.ts`, `app/components/List.vue` (`CatalogProductsList`), `app/components/_Form.vue` (`CatalogProductsForm`), `app/utils/applyDefaultLocaleProductFields.ts` (copies the default language's title + description into the main columns). The form schema requires the app's default language (`catalogProductSchemaFor(locale)`; `catalogProductSchema` = the `en` one). Importable: `@fyit/crouton-catalog/collections/products/types` and `…/server/database/{schema,queries}` |
| `required-locale.ts` | Importable `@fyit/crouton-catalog/required-locale`: `requiredLocale(codes, defaultLocale)` — the form's required language, same rule as the translation input — `localeCodes(locales)`, and `formRequiredLocale(i18n)` (reads the `useI18n()` result a form passes into its composable's default export; none passed → `en`). Used by the catalog and bookings form schemas and bookings' own-product writer |
| `app/app.config.ts` | Registers `croutonCollections.catalogProducts` (with `adminNav` → one "Products" entry in the admin menu's Collections group, opening core's generic collection page) and `croutonApps.products` (no routes, so it adds no second menu entry) |
| `server/db/schema.ts` | Re-exports `catalogProducts` so each consuming app's `db:generate` picks up the table through the layer graph |
| `seed/index.ts` | Seed provider `catalog`: two products per team, "Court" and "Kayak" (`seed:catalog-product:<team>:court/kayak`); translations in the seed's locale + `nl` |
| `products-schema.json` | Field description read by the manifest for AI hints; the source of truth is `collections/products/server/database/schema.ts` |
| `crouton.manifest.ts` | `ownsCollections: true` — the CLI refuses to generate this collection into an app |
| `test/` | Real route handlers + queries over in-memory SQLite: access (`product-access`), team scope (`product-team-scope`), body validation, form title |

## Routes and who may call them

| Route | Who |
|-------|-----|
| `GET /api/teams/[id]/catalog-products` (`?ids=a,b`) | any team member (`resolveTeamAndCheckMembership`) |
| `POST /api/teams/[id]/catalog-products` | team admin/owner (`requireTeamAdmin`) |
| `PATCH /api/teams/[id]/catalog-products/[productId]` | team admin/owner |
| `DELETE /api/teams/[id]/catalog-products/[productId]` | team admin/owner |

Every query is scoped by `teamId`; a wrong-team PATCH/DELETE answers 404 and changes nothing.
POST/PATCH bodies go through zod with `.strip()`; `teamId`/`owner` never come from the body.
DELETE first calls the Nitro hook `crouton:catalog:before-delete-product` (`{ teamId, productId, blockers }`,
typed in `server/crouton-hooks.d.ts`, #4278); any blocker → 409 with `message` = the blockers joined, a
listener that throws → 409 'Could not check whether this product is still in use. Nothing was deleted.';
nothing is deleted in either case.
No public query registry and no plugin: products are not offered to public pages.

## How a consuming package uses it

Extend it from the package's `nuxt.config.ts` and depend on it in `package.json`
(`"@fyit/crouton-catalog": "workspace:*"`), as `@fyit/crouton-bookings` does. Apps extending
bookings then get the table (migration via `db:generate`), the admin menu entry and the seed rows
with no app change. Server code may import the queries from
`@fyit/crouton-catalog/collections/products/server/database/queries`.

A package that stores product ids should guard deletes: listen on `crouton:catalog:before-delete-product`
from a server plugin (reference `../../../crouton-catalog/server/crouton-hooks.d.ts`) and push one
plain-language sentence per reason onto `blockers` — see `crouton-bookings/server/plugins/catalog-delete-guard.ts`.

## Testing

```bash
pnpm exec vitest run --root packages/crouton-catalog
```

(Avoid `pnpm --filter @fyit/crouton-catalog test` as a proof: on a mistyped filter it prints
"No projects matched" and exits 0.)

Typecheck is listed under `excluded` (#3871) in `scripts/typecheck-packages.json`: checked
standalone, `~~/server/db/schema` resolves to this package's own schema (no `user` export) and
other packages' files error — same shape as crouton-assets.
