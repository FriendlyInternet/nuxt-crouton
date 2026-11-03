/**
 * #2462 contract — which changed files get a gallery review link on a PR.
 *
 *   node --test scripts/gallery-links.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedPieces, galleryLinks, touchesPieces } from './gallery-links.mjs'

test('a .vue under a package app/components is a piece', () => {
  assert.deepEqual(
    changedPieces([
      'packages/crouton-auth/app/components/Crouton/UserPill.vue',
      'packages/crouton-admin/app/components/TeamColorSwatchPicker.vue',
    ]),
    [
      'packages/crouton-admin/app/components/TeamColorSwatchPicker.vue',
      'packages/crouton-auth/app/components/Crouton/UserPill.vue',
    ],
  )
})

test('stubs, non-.vue files, apps and pocs are not pieces', () => {
  assert.deepEqual(
    changedPieces([
      'packages/crouton-core/app/components/stubs/CroutonUserPill.vue',
      'packages/crouton-auth/app/composables/useSession.ts',
      'packages/crouton-auth/app/pages/login.vue',
      'apps/velo/app/components/Thing.vue',
      'pocs/pins/app/components/Pin.vue',
    ]),
    [],
  )
})

test('a removed piece is not linked; duplicates collapse', () => {
  const f = 'packages/crouton-auth/app/components/Crouton/UserPill.vue'
  assert.deepEqual(changedPieces([{ filename: f, status: 'removed' }, f, f]), [f])
  assert.deepEqual(changedPieces([{ filename: f, status: 'modified' }]), [f])
})

test('touchesPieces answers the deploy question', () => {
  assert.equal(touchesPieces(['packages/crouton-auth/app/components/Crouton/UserPill.vue']), true)
  assert.equal(touchesPieces(['packages/crouton-auth/server/api/x.ts']), false)
})

test('links point at the gallery file lookup, url-encoded, base without trailing slash', () => {
  assert.deepEqual(
    galleryLinks('https://gallery-pr12.example.dev/', ['packages/crouton-pages/app/components/Blocks/Render/EmbedBlock.vue']),
    [{
      file: 'packages/crouton-pages/app/components/Blocks/Render/EmbedBlock.vue',
      url: 'https://gallery-pr12.example.dev/__review?file=packages%2Fcrouton-pages%2Fapp%2Fcomponents%2FBlocks%2FRender%2FEmbedBlock.vue',
    }],
  )
})

test('links are capped so a sweeping PR does not post a wall', () => {
  const many = Array.from({ length: 30 }, (_, i) => `packages/crouton-core/app/components/P${String(i).padStart(2, '0')}.vue`)
  const links = galleryLinks('https://g.dev', many)
  assert.equal(links.length, 10)
})
