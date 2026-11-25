# @fyit/crouton-catalog

The shared team product list for nuxt-crouton: what a team offers. Bookings uses it (a
location will give a product a stock); sales can later give the same products a price.

## What you get

- A `catalogProducts` collection (`catalog_products` table): `title`, `description`,
  `active`, and per-locale `translations`.
- One **Products** entry in the admin menu, opening the product list (core's generic
  collection page) with add / edit / switch off / delete.
- Team-scoped CRUD routes under `/api/teams/[id]/catalog-products`: any member may read,
  only a team admin may create, change or delete.
- A seed provider that adds "Court" and "Kayak" to each team.

## Install

You normally get it through `@fyit/crouton-bookings`, which extends it. To use it directly:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-core', '@fyit/crouton-catalog']
})
```

Then run your app's `db:generate` to add the `catalog_products` migration.

## Test

```bash
pnpm exec vitest run --root packages/crouton-catalog
```
