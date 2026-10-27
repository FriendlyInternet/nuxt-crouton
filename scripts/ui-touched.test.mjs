/**
 * #2780 contract — a change is visual only when something on screen can change.
 *
 *   node --test scripts/ui-touched.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uiTouched, isCommentOrBlank, underUiKey } from './ui-touched.mjs'

const none = () => null

// Real hunks from PR #2720 (comment edit in Library.vue, dead key in app.config.ts).
const PR_2720 = `diff --git a/packages/crouton-assets/app/components/Library.vue b/packages/crouton-assets/app/components/Library.vue
--- a/packages/crouton-assets/app/components/Library.vue
+++ b/packages/crouton-assets/app/components/Library.vue
@@ -10 +10 @@ const { getConfig } = useCollections()
-// The package registers a partial 'assets' config (packageForm only, no apiPath),
+// The package registers a partial 'assets' config (no apiPath),
diff --git a/packages/crouton-bookings/CLAUDE.md b/packages/crouton-bookings/CLAUDE.md
--- a/packages/crouton-bookings/CLAUDE.md
+++ b/packages/crouton-bookings/CLAUDE.md
@@ -21 +21 @@
-old
+new
diff --git a/packages/crouton-bookings/app/app.config.ts b/packages/crouton-bookings/app/app.config.ts
--- a/packages/crouton-bookings/app/app.config.ts
+++ b/packages/crouton-bookings/app/app.config.ts
@@ -171,2 +171 @@ export default defineAppConfig({
-    // Package-provided form for locations
-    bookingsLocations: { packageForm: 'X' },
+    bookingsLocations: {},
`

const CONFIG_OLD = [
  'export default defineAppConfig({',
  '  croutonCollections: {',
  '    a: 1,',
  '    // Package-provided form for locations',
  "    bookingsLocations: { packageForm: 'X' },",
  '  },',
  '})'
]

test('PR #2720 replays as not visual', () => {
  assert.equal(uiTouched(PR_2720, () => CONFIG_OLD), 0)
})

test('a template class= change is visual', () => {
  const d = `diff --git a/a/app/components/X.vue b/a/app/components/X.vue
--- a/a/app/components/X.vue
+++ b/a/app/components/X.vue
@@ -3 +3 @@
-  <div class="p-2">
+  <div class="p-4">
`
  assert.equal(uiTouched(d, none), 1)
})

test('a script-only .vue change still counts', () => {
  const d = `diff --git a/x.vue b/x.vue
--- a/x.vue
+++ b/x.vue
@@ -1 +1 @@
-const a = 1
+const a = 2
`
  assert.equal(uiTouched(d, none), 1)
})

test('app.config.ts change under ui: is visual; unreadable file holds', () => {
  const lines = ['export default {', '  ui: {', '    button: {', '      x: 1', '    }', '  },', '  other: 1', '}']
  const d = n => `diff --git a/app.config.ts b/app.config.ts
--- a/app.config.ts
+++ b/app.config.ts
@@ -${n} +${n} @@
-x
+y
`
  assert.equal(uiTouched(d(4), () => lines), 1)
  assert.equal(uiTouched(d(7), () => lines), 0)
  assert.equal(uiTouched(d(7), none), 1)
})

test('comment/blank classifier', () => {
  assert.ok(isCommentOrBlank('  // hi'))
  assert.ok(isCommentOrBlank('<!-- hi -->'))
  assert.ok(isCommentOrBlank(' * doc line'))
  assert.ok(isCommentOrBlank(''))
  assert.ok(!isCommentOrBlank('* { margin: 0 }'))
  assert.ok(!isCommentOrBlank('<div> <!-- x -->'))
})

test('underUiKey walks ancestors', () => {
  assert.ok(underUiKey(['a: {', '  ui: {', '    b: 1', '  }', '}'], 3))
  assert.ok(!underUiKey(['a: {', '  ui: {', '    b: 1', '  },', '  c: 2', '}'], 5))
})
