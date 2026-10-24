### Schema review — `pages`

6 fields

| Field | Type | Required | Translatable | Default | → References |
|---|---|:--:|:--:|---|---|
| `title` | string | ✓ |  |  |  |
| `slug` ·uniq | string | ✓ |  |  |  |
| `isHome` | boolean |  |  | `false` |  |
| `status` | string | ✓ |  | `draft` |  |
| `showInNavigation` | boolean |  |  | `true` |  |
| `board` | json |  |  |  |  |

_No relationships._
