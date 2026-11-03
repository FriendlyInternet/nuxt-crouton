# gallery

Every shared UI piece (`packages/crouton-*/app/components`) on its own review link — like
themes.pmcp.dev, for every part (#2462). Staging: https://gallery-staging.pmcp.dev/__review

- **`/__review`** — the list, grouped by package, with search.
- **`/__review/<ComponentName>`** — one piece. Loads only that piece's code.
- **`/__review?file=packages/<pkg>/app/components/X.vue`** — the same page, found by file. A PR that
  changes a piece gets the gallery deployed and one such link per changed piece in its preview
  comment (`scripts/gallery-links.mjs`).

## What a piece is shown with (later wins)

1. a page block's own default content (core blocks + addon `croutonBlocks`), automatically;
2. its line in `app/review-samples.ts` — add one when a piece needs input to look like itself;
3. `?props={...}` on the link.

A piece still missing a required input shows "Needs: …" instead of a blank page. The sliders
button switches who's looking (signed in / PIN visitor / signed out — client-side only, the
server still sees no session) and pushes status messages.

Pieces that load data from the server need a real sign-in: use the review sign-in link the
staging deploy emails.

## How the list is built

`modules/review-pieces.ts` writes `#build/gallery-pieces.mjs` at build time: one lazy
`import()` per package component (stubs and server components skipped). New components appear
on the next deploy with no extra work.

## Dev / deploy

```bash
pnpm --filter gallery dev        # local
# staging: dispatch deploy-pocs.yml with app=gallery (or merge to main)
```
