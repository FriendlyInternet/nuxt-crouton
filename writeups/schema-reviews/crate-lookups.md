### Schema review — `lookups`

3 fields · 1 relationship

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `trackId` ·uniq | string | ✓ |  |  | `tracks` |
| `fetchedAt` | date | ✓ |  |  |  |
| `results` | json |  |  |  |  |

**Relationships:** `lookups.trackId` → `tracks`
