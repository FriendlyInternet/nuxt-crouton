#!/usr/bin/env node
// Thin shim (#1238) — the implementation is shared at <repo>/scripts/lib/sync-wrangler-ids.mjs.
// Apps scaffolded OUTSIDE this monorepo get the full self-contained copy from
// packages/crouton-cli/lib/templates/wrangler/sync-wrangler-ids.mjs.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { syncWranglerIds } from '../../../scripts/lib/sync-wrangler-ids.mjs'

syncWranglerIds(join(dirname(fileURLToPath(import.meta.url)), '..'))
