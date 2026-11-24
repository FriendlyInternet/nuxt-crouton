# PipelineItems

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `pipelineItems` |
| API | `/api/teams/[teamId]/pipeline-items` |
| Components | `<PipelineItemsForm />`, `<PipelineItemsList />` |
| Composable | `usePipelineItems()` |

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| number | number | Yes |
| title | string | No |
| url | string | No |
| stage | string | No |
| labels | string | No |
| prLabels | string | No |
| prNumber | number | No |
| prHeadSha | string | No |
| prBase | string | No |
| verdict | string | No |
| verdictSha | string | No |
| checksRed | boolean | No |
| checksSha | string | No |
| closedAt | date | No |
| stageSince | date | No |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/items/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/usePipelineItems.ts   # Zod schema, columns, config
├── server/api/teams/[id]/pipeline-items/
│   ├── index.get.ts / index.post.ts
│   └── [itemId].patch.ts / [itemId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
