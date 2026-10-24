### Schema review — `bookings`

5 fields · 1 relationship

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `artist` | string | ✓ |  |  | `artists` |
| `venue` | string | ✓ |  |  |  |
| `date` | date | ✓ |  |  |  |
| `fee` | decimal(10,2) |  |  |  |  |
| `status` | string | ✓ |  | `pending` |  |

**Relationships:** `bookings.artist` → `artists`
