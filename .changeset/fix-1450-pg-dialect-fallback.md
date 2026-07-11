---
"@fyit/crouton-cli": patch
---

`crouton config`: an explicit `dialect: null`/`''` in the config file no longer
silently routes into the unexercised PostgreSQL path — the fallback is now sqlite
(matching the c12 default that already covers an absent key). Centralized the
fallback in `resolveDialect()` so it lives in one testable place. Fixes #1450.
