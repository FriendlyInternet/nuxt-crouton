# InboxCards

> Generated once by @fyit/crouton-cli. From here on it's yours:
> edit any file in this folder. `crouton config` skips files that already exist;
> only `--force` overwrites them.

| | |
|---|---|
| Collection | `inboxCards` |
| API | `/api/teams/[teamId]/inbox-cards` |
| Components | `<InboxCardsForm />`, `<InboxCardsList />` |
| Composable | `useInboxCards()` |

## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
| kind | string | Yes |
| sourceType | string | Yes |
| sourceNumber | number | Yes |
| sourceCommentId | string | No |
| title | string | Yes |
| ask | text | Yes |
| recommendation | text | No |
| link | string | Yes |
| payload | json | No |
| state | string | Yes |
| answer | string | No |
| answerNote | text | No |
| answeredVia | string | No |
| answerUrl | string | No |
| askedAt | date | Yes |
| answeredAt | date | No |
| createdAt | timestamp | Auto |
| updatedAt | timestamp | Auto |
| createdBy | string | Auto |
| updatedBy | string | Auto |

## Files

```
collections/cards/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/useInboxCards.ts   # Zod schema, columns, config
├── server/api/teams/[id]/inbox-cards/
│   ├── index.get.ts / index.post.ts
│   └── [cardId].patch.ts / [cardId].delete.ts
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
```

To add a field: edit the schema, the composable and the form, or regenerate with `--force`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
