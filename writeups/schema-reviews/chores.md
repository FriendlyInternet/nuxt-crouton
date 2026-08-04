### Schema review — `chores`

6 fields

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `name` | text | ✓ |  |  |  |
| `cadence` | select | ✓ |  |  |  |
| `assignee` | relation | ✓ |  |  |  |
| `lastDoneBy` | relation |  |  |  |  |
| `lastDoneAt` | datetime |  |  |  |  |
| `notes` | textarea |  |  |  |  |

_No relationships._
