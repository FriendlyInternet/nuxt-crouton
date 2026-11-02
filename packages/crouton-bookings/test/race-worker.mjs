// Worker for the race test (#3139): opens its OWN connection to the shared WAL file,
// waits on the barrier, then runs the real batch handler for the last place.
import { workerData, parentPort } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const { createJiti } = require('jiti')

const { dbPath, barrier, body } = workerData
const db = drizzle(new Database(dbPath))
db.$client.pragma('busy_timeout = 5000')

globalThis.defineEventHandler = fn => fn
globalThis.createError = e => Object.assign(new Error(e.statusText), e, { statusCode: e.status })
globalThis.useDB = () => db
globalThis.useRuntimeConfig = () => ({})
globalThis.readBody = async () => body

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: {
    '@fyit/crouton-auth/server/utils/team': join(here, 'stubs/team.mjs'),
    'nitropack/runtime': join(here, 'stubs/nitro.mjs'),
  },
})
const handler = (await jiti.import(join(here, '../server/api/crouton-bookings/teams/[id]/customer-bookings-batch.post.ts'))).default

// barrier: signal ready, then block until the main thread releases everyone at once
const flag = new Int32Array(barrier)
Atomics.add(flag, 1, 1)
Atomics.notify(flag, 1)
Atomics.wait(flag, 0, 0)

try {
  await handler({})
  parentPort.postMessage({ ok: true })
}
catch (e) {
  parentPort.postMessage({ ok: false, status: e.status })
}
finally {
  db.$client.close()
}
