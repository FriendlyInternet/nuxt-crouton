### Schema review — `changes`

6 fields · 1 relationship

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `groupId` | string | ✓ |  |  |  |
| `trackId` | string | ✓ |  |  | `tracks` |
| `before` | array |  |  |  |  |
| `after` | array |  |  |  |  |
| `summary` | string |  |  |  |  |
| `undoOf` | string |  |  |  |  |

**Relationships:** `changes.trackId` → `tracks`
