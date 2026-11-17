### Schema review — `cards`

16 fields

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `kind` | string | ✓ |  |  |  |
| `sourceType` | string | ✓ |  |  |  |
| `sourceNumber` | number | ✓ |  |  |  |
| `sourceCommentId` | string |  |  |  |  |
| `title` | string | ✓ |  |  |  |
| `ask` | text | ✓ |  |  |  |
| `recommendation` | text |  |  |  |  |
| `link` | string | ✓ |  |  |  |
| `payload` | json |  |  |  |  |
| `state` | string | ✓ |  | `waiting` |  |
| `answer` | string |  |  |  |  |
| `answerNote` | text |  |  |  |  |
| `answeredVia` | string |  |  |  |  |
| `answerUrl` | string |  |  |  |  |
| `askedAt` | date | ✓ |  |  |  |
| `answeredAt` | date |  |  |  |  |

_No relationships._
