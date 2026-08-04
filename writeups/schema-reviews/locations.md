### Schema review — `locations`

4 fields · 1 relationship

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `id` 🔑 | uuid |  |  |  |  |
| `eventId` | uuid | ✓ |  |  | `events` |
| `title` | string | ✓ |  |  |  |
| `requiresHandover` | boolean |  |  | `true` |  |

**Relationships:** `locations.eventId` → `events`
