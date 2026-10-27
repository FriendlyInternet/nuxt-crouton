# MainVenues

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `mainVenues` |
| API | `/api/teams/[teamId]/main-venues` |
| Components | `<MainVenuesForm />`, `<MainVenuesList />` |
| Composable | `useMainVenues()` |

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| name | string | Yes |
| street | string | No |
| city | string | No |
| postcode | string | No |
| coordinates | string | No |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/venues/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useMainVenues.ts   # Zod schema, columns, config
├── server/api/teams/[id]/main-venues/
│   ├── index.get.ts / index.post.ts
│   └── [venueId].patch.ts / [venueId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
