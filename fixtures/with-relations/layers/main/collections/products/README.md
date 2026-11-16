# MainProducts

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `mainProducts` |
| API | `/api/teams/[teamId]/main-products` |
| Components | `<MainProductsForm />`, `<MainProductsList />` |
| Composable | `useMainProducts()` |

- References: categoryId → categories

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| title | string | Yes |
| categoryId | string (→ categories) | No |
| price | decimal | No |
| inStock | boolean | No |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/products/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useMainProducts.ts   # Zod schema, columns, config
├── server/api/teams/[id]/main-products/
│   ├── index.get.ts / index.post.ts
│   └── [productId].patch.ts / [productId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
