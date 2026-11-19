# MainCategories

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `mainCategories` |
| API | `/api/teams/[teamId]/main-categories` |
| Components | `<MainCategoriesForm />`, `<MainCategoriesList />` |
| Composable | `useMainCategories()` |

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| title | string | Yes |
| displayOrder | number | No |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/categories/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useMainCategories.ts   # Zod schema, columns, config
├── server/api/teams/[id]/main-categories/
│   ├── index.get.ts / index.post.ts
│   └── [categoryId].patch.ts / [categoryId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
