# SpikeTasks

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `spikeTasks` |
| API | `/api/teams/[teamId]/spike-tasks` |
| Components | `<SpikeTasksForm />`, `<SpikeTasksList />` |
| Composable | `useSpikeTasks()` |

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| title | string | Yes |
| done | boolean | No |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/tasks/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useSpikeTasks.ts   # Zod schema, columns, config
├── server/api/teams/[id]/spike-tasks/
│   ├── index.get.ts / index.post.ts
│   └── [taskId].patch.ts / [taskId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
