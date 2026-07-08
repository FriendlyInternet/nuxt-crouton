#!/usr/bin/env node
// Thin shim (#1238) — the implementation is shared at <repo>/scripts/lib/inject-wrangler-env.mjs.
// Apps scaffolded OUTSIDE this monorepo get the full self-contained copy from
// packages/crouton-cli/lib/templates/wrangler/inject-wrangler-env.mjs.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { injectWranglerEnv } from '../../../scripts/lib/inject-wrangler-env.mjs'

injectWranglerEnv(join(dirname(fileURLToPath(import.meta.url)), '..'))
