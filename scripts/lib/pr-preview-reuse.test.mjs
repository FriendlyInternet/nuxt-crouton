// layer: stack
/**
 * #2608 contract — a PR preview's deploy must be repeatable.
 *
 * Per-PR previews strip their storage ids so wrangler creates fresh ones, named after the
 * preview (#2020). If a deploy dies after creating them but before the Worker exists, every
 * later deploy tries to create them again and Cloudflare refuses:
 *
 *     a namespace with this account ID and title already exists [code: 10014]
 *
 * — the preview is stuck for good (#2571). So before deploying, storage that already exists
 * under the preview's names is pinned by id and reused; only what's missing is created.
 * The teardown needs the same lookup: KV is deleted by id, never by its title.
 *
 *   node --test scripts/lib/pr-preview-reuse.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reuseExisting, previewKvTitle, findKvId } from './pr-preview-reuse.mjs'

const built = () => ({
  name: 'booking-demo-pr2571',
  d1_databases: [{ binding: 'DB', database_name: 'booking-demo-pr2571-db', migrations_dir: '/abs/m' }],
  kv_namespaces: [{ binding: 'KV' }],
})

test('the KV title matches what wrangler creates for the preview', () => {
  assert.equal(previewKvTitle('booking-demo-pr2571', 'KV'), 'booking-demo-pr2571-kv')
})

test('existing storage left by a failed deploy is reused, not re-created', () => {
  const cfg = built()
  const r = reuseExisting(cfg, {
    d1List: [{ name: 'booking-demo-pr2571-db', uuid: 'D1-UUID' }],
    kvList: [{ title: 'booking-demo-pr2571-kv', id: 'KV-ID' }],
  })
  assert.equal(cfg.d1_databases[0].database_id, 'D1-UUID')
  assert.equal(cfg.kv_namespaces[0].id, 'KV-ID')
  assert.deepEqual(r.reused.sort(), ['DB → D1-UUID', 'KV → KV-ID'])
  assert.deepEqual(r.fresh, [])
})

test('a first deploy with nothing in place creates everything fresh', () => {
  const cfg = built()
  const r = reuseExisting(cfg, { d1List: [{ name: 'other-db', uuid: 'X' }], kvList: [{ title: 'other-kv', id: 'Y' }] })
  assert.equal(cfg.d1_databases[0].database_id, undefined)
  assert.equal(cfg.kv_namespaces[0].id, undefined)
  assert.deepEqual(r.fresh.sort(), ['DB', 'KV'])
})

test('an id that is already set is left alone', () => {
  const cfg = built()
  cfg.kv_namespaces[0].id = 'PINNED'
  reuseExisting(cfg, { kvList: [{ title: 'booking-demo-pr2571-kv', id: 'OTHER' }] })
  assert.equal(cfg.kv_namespaces[0].id, 'PINNED')
})

test('D1 lists using `id` instead of `uuid` are read too', () => {
  const cfg = built()
  reuseExisting(cfg, { d1List: [{ name: 'booking-demo-pr2571-db', id: 'D1-ID' }] })
  assert.equal(cfg.d1_databases[0].database_id, 'D1-ID')
})

test('teardown finds a KV id by its title, and nothing for a miss', () => {
  const list = [{ title: 'booking-demo-pr2571-kv', id: 'KV-ID' }, { title: 'x', id: 'X' }]
  assert.equal(findKvId(list, 'booking-demo-pr2571-kv'), 'KV-ID')
  assert.equal(findKvId(list, 'booking-demo-pr9999-kv'), null)
  assert.equal(findKvId(undefined, 'anything'), null)
})
