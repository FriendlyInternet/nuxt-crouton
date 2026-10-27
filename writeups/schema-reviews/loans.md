### Schema review — `loans`

7 fields

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `item` | text | ✓ |  |  |  |
| `borrower` | text | ✓ |  |  |  |
| `lentDate` | date | ✓ |  |  |  |
| `expectedBackDate` | date |  |  |  |  |
| `returned` | boolean |  |  | `false` |  |
| `returnedDate` | date |  |  |  |  |
| `notes` | textarea |  |  |  |  |

_No relationships._
