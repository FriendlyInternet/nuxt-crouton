### Schema review — `handovers`

3 fields · 2 relationships

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `id` 🔑 | uuid |  |  |  |  |
| `eventId` | uuid | ✓ |  |  | `events` |
| `orderId` ·uniq | uuid | ✓ |  |  | `orders` |

**Relationships:** `handovers.eventId` → `events` · `handovers.orderId` → `orders`
