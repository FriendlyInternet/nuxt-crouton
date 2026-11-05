### Schema review — `tracks`

15 fields

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `rekordboxId` ·uniq | string | ✓ |  |  |  |
| `name` | string | ✓ |  |  |  |
| `artist` | string |  |  |  |  |
| `album` | string |  |  |  |  |
| `genre` | string |  |  |  |  |
| `year` | number |  |  |  |  |
| `bpm` | decimal(6,2) |  |  |  |  |
| `tonality` | string |  |  |  |  |
| `durationSec` | number |  |  |  |  |
| `label` | string |  |  |  |  |
| `dateAdded` | date |  |  |  |  |
| `location` | text | ✓ |  |  |  |
| `audioPath` | string |  |  |  |  |
| `tags` | array |  |  |  |  |
| `originalComments` | text |  |  |  |  |

_No relationships._
