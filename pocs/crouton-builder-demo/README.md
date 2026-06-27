# crouton-builder-demo

A throwaway test app that proves the [`@fyit/crouton-three`](../../packages/crouton-three)
layer (TresJS / Three.js for Vue) works end-to-end in a real crouton app.

- **`/`** — landing page linking to the demo.
- **`/three`** — the demo:
  - `CroutonThreeStarterScene` — a **WASD / arrow-key** controllable cube
    (driven by `useThreeControls`).
  - `CroutonThreeModelViewer` — a **glTF model viewer** (orbit + auto-rotate),
    the same renderer the crouton-pages **3D Model** block uses. The sample
    model is served from `public/models/duck.glb` (Khronos “Duck” asset).

Extends `@fyit/crouton-core`, `@fyit/crouton-i18n`, `@fyit/crouton-three`, and
`@fyit/crouton-pages` (for the 3D Model block + generated `pages` collection).

## Crouton Builder spike — `/spike-app` (epic #907)

Build an app by dragging a collection's blocks onto a Vue Flow canvas, snap them
into bound splits, then `✨ Magic`/compile into a `LayoutTree`.

### Focus / layout-edit view (#907 — `focus-view-1`)

Double-clicking a layout node opens a **dedicated full-screen edit VIEW**, not a
Vue Flow camera zoom. This is the key design choice:

- **Why a view, not a camera.** The old approach zoomed the Vue Flow *camera*
  onto the focused node (`focusBounds` → `fitBounds`/`setCenter`). Resizing the
  focused node to a device width made Vue Flow re-measure and fire its own
  viewport fit, which raced/overrode the camera op → non-deterministic, off-screen
  framing on some nodes (reliably the **2nd** node at a mobile viewport). A plain
  overlay has no camera and no re-measure race, so **every** node renders at a
  constant, cleanly-framed on-screen size for free.
- **One unified surface.** The view hosts `CroutonLayoutBreakpointAuthor`
  (`@fyit/crouton-layout`) — which already unifies the breakpoint key-points
  (min-width ruler), the device buttons, the width slider, the per-checkpoint
  **collapse motion** (gutter-tabs / spring-drawer / crt-power-down / iris-portal),
  and per-block widget variants, with splitter drags → keypoint sizes. We compose
  it untouched in the POC (no package edit); the floating app-style header sits in
  the author's reserved top band. A subtle CSS scale+fade eases the view in.
- **Persistence contract is unchanged.** The node's layout rides in the page's
  `zoomTree` `v-model` (root + authored breakpoints); resize→keypoint is the
  author's own job. `Done` returns to the board.
- **Detach** is a **board gesture** (consolidated from the detach-redesign branch):
  grab a pane of a merged node and pull it — the group eases apart, the pane tracks
  your finger 1:1 (zoom-corrected) and past a threshold detaches into its own flow
  node exactly where you release; under the threshold it springs back. The edit view
  stays focused purely on responsiveness.
- **Overview-on-add** (also consolidated): adding a block re-frames the board to an
  overview (`fitView` with `maxZoom:1`) instead of hard-zooming the first block on a
  phone.

Verify the framing fix at a **mobile viewport (390×844)**: drop 2 blocks →
double-click each → both open framed identically and fully on-screen. Drag one block
onto another to merge → pull a pane out (it follows your finger and detaches where you
release) → add a block (the camera frames an overview, not a hard zoom).

## Local dev

```bash
pnpm install
pnpm --filter crouton-builder-demo dev      # http://localhost:3008  (→ /three)
pnpm --filter crouton-builder-demo typecheck
```

`hub: { db: 'sqlite', kv: true }` → local SQLite + KV in dev; D1 + KV on
Cloudflare. No env vars required beyond `BETTER_AUTH_SECRET`.

## Deploy — Cloudflare **Workers** (static assets) — pilot for #109

> This app is the pilot for [#109](https://github.com/FriendlyInternet/nuxt-crouton/issues/109)
> (epic [#108](https://github.com/FriendlyInternet/nuxt-crouton/issues/108)): deploying via
> the **Workers** static-assets preset instead of Pages, so D1 + KV are
> **auto-provisioned** instead of created by hand. Other apps stay on Pages
> unless/until this proves clearly better.

Not deployed with `nuxthub deploy`. Build uses Nitro's `cloudflare_module`
preset → `.output/` (a Worker + `.output/public` static assets); Nitro writes
the deployable config to `.output/server/wrangler.json`, injecting `main` and
the `ASSETS` binding from this app's `wrangler.jsonc`.

The D1 + KV bindings in `wrangler.jsonc` are intentionally **id-less**:
[wrangler auto-provisioning](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/)
(4.45+) creates and links `crouton-builder-demo-db` + the KV namespace on the first
`wrangler deploy`, and keeps them linked across deploys — no `/deploy` first-time
setup, no ids to paste.

```bash
# needs Cloudflare auth once: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (or `wrangler login`)
pnpm --filter crouton-builder-demo cf:deploy          # build + wrangler deploy → *.workers.dev URL (auto-provisions D1+KV)
pnpm --filter crouton-builder-demo db:migrate:prod    # apply D1 migrations remotely (see #13632 caveat)
pnpm --filter crouton-builder-demo cf:staging         # deploy the isolated staging env
```

Local Worker run (no Cloudflare account needed — uses `workerd`/miniflare):

```bash
pnpm --filter crouton-builder-demo build              # or: NITRO_PRESET=cloudflare_module nuxt build
npx wrangler --cwd apps/crouton-builder-demo/.output dev
```

> **Open follow-ups (tracked on #108/#109):** remote D1 migrations against an
> auto-provisioned binding ([workers-sdk#13632](https://github.com/cloudflare/workers-sdk/issues/13632)),
> a CI deploy workflow for the Workers path (the existing
> `.github/workflows/deploy-crouton-builder-demo.yml` still targets Pages), and confirming
> per-PR preview parity with Pages.
