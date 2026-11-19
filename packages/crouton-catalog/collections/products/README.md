# CatalogProducts Collection

Owned by `@fyit/crouton-catalog` (not generated into apps).

## Overview

| Property | Value |
|----------|-------|
| Collection Name | `catalogProducts` |
| Table | `catalog_products` |
| Layer | `catalog` |
| API Base | `/api/teams/[teamId]/catalog-products` |
| Form Component | `<CatalogProductsForm />` |
| List Component | `<CatalogProductsList />` |
| Composable | `useCatalogProducts()` |

## Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | text | yes | Main title; the form mirrors the English translation into it |
| `description` | text | no | |
| `active` | boolean | no | Default `true`; switch off to stop offering a product without deleting it |
| `translations` | JSON | no | Per locale `{ title?, description? }` |

Plus the system columns `id`, `teamId`, `owner`, `order`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.

## File Structure

```
collections/products/
├── app/
│   ├── components/
│   │   ├── _Form.vue             # CatalogProductsForm: I18n title/description + active switch
│   │   └── List.vue              # CatalogProductsList: title + active columns
│   ├── composables/
│   │   └── useCatalogProducts.ts # Schema, columns, config
│   └── utils/
│       └── applyDefaultLocaleProductFields.ts  # Mirrors the default language's title + description into the main columns
├── server/
│   ├── api/teams/[id]/catalog-products/
│   │   ├── index.get.ts          # GET all / by IDs (?ids=) — any team member
│   │   ├── index.post.ts         # CREATE — team admin
│   │   ├── [productId].patch.ts  # UPDATE — team admin
│   │   └── [productId].delete.ts # DELETE — team admin
│   └── database/
│       ├── schema.ts             # Drizzle schema (catalog_products)
│       └── queries.ts            # Team-scoped query functions
├── types.ts                      # TypeScript interfaces
└── nuxt.config.ts                # Component prefix CatalogProducts
```

## Access

Every query carries a `teamId` condition, so a request can never read, change or
delete another team's product (a wrong-team update/delete returns 404). POST and
PATCH validate the body with zod and strip unknown keys; `teamId` and `owner`
always come from the route and the session.
