---
title: Generated code
description: What each generated file does, which files the generator keeps rewriting, and what running it again does to your edits.
navigation:
  icon: i-lucide-code
---

The generator writes plain source files. Once written they are yours: read them, edit them, commit them. Nothing at runtime reads your field file; only the generated files count.

## The files of one collection

For collection `products` in layer `shop`, in `layers/shop/collections/products/`:

| File | What it does |
| --- | --- |
| `app/components/_Form.vue` | the create/edit form, registered as `<ShopProductsForm>` |
| `app/components/List.vue` | the list, registered as `<ShopProductsList>`; loads rows with `useCollectionQuery` and renders `<CroutonCollection>` |
| `app/composables/useShopProducts.ts` | the Zod schema, default values, columns and `shopProductsConfig` (the registry entry) |
| `server/api/teams/[id]/shop-products/index.get.ts` | list: all rows, `?ids=`, `?page=&pageSize=`, reference-field filters |
| `server/api/teams/[id]/shop-products/index.post.ts` | create |
| `server/api/teams/[id]/shop-products/[productId].patch.ts` | update (only the fields sent) |
| `server/api/teams/[id]/shop-products/[productId].delete.ts` | delete |
| `server/database/schema.ts` | the Drizzle table `shop_products` |
| `server/database/queries.ts` | `getAllShopProducts`, `getShopProductsByIds`, `createShopProduct`, `updateShopProduct`, `deleteShopProduct` |
| `types.ts` | the record type and `ShopProductsFormProps` |
| `seed.json` | sample rows you can edit |
| `nuxt.config.ts`, `README.md` | the collection's layer config and a short description |

Every route checks team membership first (`resolveTeamAndCheckMembership`). Update and delete also check ownership; see [Who may change what](/fundamentals/data-operations#who-may-change-what). What the routes accept: [Data operations](/fundamentals/data-operations#passing-query-parameters).

Most files start with a comment block (`@crouton-generated`, the collection, the API path, and the common changes for that file). It is there to help someone, or an agent, find their way in the file. Deleting it changes nothing.

## Outside the collection folder

A run also updates a few shared files. It **adds to** them rather than replacing them, and it does so on every run:

- `nuxt.config.ts`: adds `./layers/shop` to `extends`
- `app/app.config.ts`: adds `shopProducts` to `croutonCollections`
- the app's database schema index: exports the new table
- `server/db/migrations/`: a new migration when the tables changed

## Regenerating

Run `crouton config` again and the generator **skips every collection file that already exists**. It lists them at the end:

```
  ⏭ preserved 13 existing file(s) — use --force to overwrite:
     · app/components/_Form.vue
     ...
```

Files that don't exist yet are always written. So deleting one file and regenerating restores only that file.

This means **a changed field file has no effect on an existing collection** until you overwrite:

```bash
npx crouton config --dry-run   # shows the plan, writes nothing
npx crouton config --force     # rewrites every generated file, your edits included
npx crouton config --only products --force   # the same, for one collection
```

`--force` replaces your edits in those files with no merge. Commit first, so you can bring your changes back from the diff. With `--force`, `schema.ts` is rewritten too, and the next migration changes the table to match.

## Keeping your changes safe

- **Small changes, such as a column, a label or a query filter:** edit the generated file. A normal regenerate leaves it alone.
- **A different form or list for good:** put `app/components/ShopProductsForm.vue` (or `ShopProductsList.vue`) in your app. A component in the app wins over the same name in a layer, and the generator never writes there, not even with `--force`. See [Eject](/customization/eject).
- **Removing a collection:** `npx crouton rollback shop products --dry-run`, then without `--dry-run`. It removes the files and the registry, `extends` and schema entries, but not the table. Add `--drop-table` for a migration that drops it.

## Related

- [Architecture](/fundamentals/architecture): how these files use the core layer
- [Schema format](/generation/schema-format): the field file
- [CLI reference](/api-reference/cli): every command and flag
