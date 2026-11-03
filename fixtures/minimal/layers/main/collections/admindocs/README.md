# MainAdmindocs

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `mainAdmindocs` |
| API | `/api/teams/[teamId]/main-admindocs` |
| Components | `<MainAdmindocsForm />`, `<MainAdmindocsList />` |
| Composable | `useMainAdmindocs()` |

- Tree collection: items have a parent, a path and an order.

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| title | string | Yes |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/admindocs/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useMainAdmindocs.ts   # Zod schema, columns, config
├── server/api/teams/[id]/main-admindocs/
│   ├── index.get.ts / index.post.ts
│   ├── [admindocId].patch.ts / [admindocId].delete.ts
│   ├── [admindocId]/move.patch.ts
│   └── reorder.patch.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
