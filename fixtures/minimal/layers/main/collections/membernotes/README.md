# MainMembernotes

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `mainMembernotes` |
| API | `/api/teams/[teamId]/main-membernotes` |
| Components | `<MainMembernotesForm />`, `<MainMembernotesList />` |
| Composable | `useMainMembernotes()` |

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
collections/membernotes/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useMainMembernotes.ts   # Zod schema, columns, config
├── server/api/teams/[id]/main-membernotes/
│   ├── index.get.ts / index.post.ts
│   └── [membernoteId].patch.ts / [membernoteId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
