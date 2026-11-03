# ticket-editor

A tiny Excalidraw editor that commits edits **straight back to the repo** — the mobile
round-trip for `ticket-diagram` diagrams with **zero third-party login** (your phone never
authorizes anything). On Save, Excalidraw exports the PNG in-browser, so the committed image is
exactly what you edited (WYSIWYG). Sub-issue #503 of epic #483.

Auth = the **Crouton GitHub App** (#519): the Worker mints a short-lived (~1h) installation token
just-in-time (WebCrypto, dependency-free) and commits as `nuxt-harness[bot]` — no stored PAT. See
`SECRETS.md` and `writeups/setup/secrets-and-tokens.md`.

## Routes

- `GET /?slug=<slug>&branch=<branch>[&issue=<NN>]` — the editor (loads `writeups/diagrams/<slug>.excalidraw`). Pass `issue` to get a handoff comment on Save.
- `POST /api/save` `{ slug, branch, scene, png, issue? }` — commits `<slug>.excalidraw` (+ `<slug>.png`) to `<branch>`. If `issue` is set, each Save also **posts a new comment** on that issue with the diagram **pinned to the commit it was saved at** (`raw.githubusercontent.com/<repo>/<sha>/<path>` is immutable, so the image never drifts). Result: a **timeline of frozen diagrams** — the original proposal comment keeps the original, each edit is its own comment — that a reviewer can compare and reply `approve`/`lgtm` to (#583). The comment is non-fatal — a commit always wins.

**Owner-only saves (#3261).** `POST /api/save` needs `Authorization: Bearer <owner token>` — a 10-minute
HMAC token minted by `https://status.pmcp.dev/api/editor/token` for the signed-in owner (the editor does
this round trip itself when Save returns 401). No/invalid token → **401** and nothing is written. The
default branch and any protected branch (read from GitHub) → **403**; an `issue` that is not a real issue
(a PR, or missing) → **403**. Viewing (`GET /`) stays public. If every save returns 403, the App lacks
permission to read branch protection (Contents: read).

## Deploy (Cloudflare Workers)

CI deploys on push to `main` (`.github/workflows/deploy-ticket-editor.yml`) and sets `OWNER_TOKEN_SECRET`
itself. Manual deploy:


```bash
cd workers/ticket-editor
pnpm install
npx wrangler secret put GITHUB_APP_PRIVATE_KEY   # the Crouton App's PEM private key (only secret)
# set GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID as wrangler vars (not sensitive)
npx wrangler deploy                              # → https://diagram.pmcp.dev (+ the .workers.dev URL)
```

The custom domain `diagram.pmcp.dev` is declared in `wrangler.jsonc` (`routes` with
`custom_domain: true`); Wrangler provisions the route + DNS on deploy — no manual dashboard step
(the `pmcp.dev` zone must be in the account, and the API token needs zone Workers Routes + DNS edit).

Then open `https://diagram.pmcp.dev/?slug=make-tickets-human-readable&branch=<branch>&issue=<NN>`
on your phone → edit → **Save** → a commit (authored by `nuxt-harness[bot]`) lands on the branch, and
(with `&issue=<NN>`) a comment with the frozen diagram is posted on that issue. Link that URL from each
diagram's comment as a one-tap **✏️ Edit**.

## Notes

- Auth is the **Crouton GitHub App** (#519) — short-lived installation tokens minted at runtime
  directly with **WebCrypto** (dependency-free; sign an App JWT → exchange for an installation
  token); **no stored PAT**. The one durable secret is the App private key. Full model in
  `SECRETS.md` + `writeups/setup/secrets-and-tokens.md`.
- The editor loads React, ReactDOM and Excalidraw as **UMD `<script>` globals** from the unpkg CDN
  (Excalidraw's official no-build recipe). `window.EXCALIDRAW_ASSET_PATH` points at the same unpkg
  `dist/` so Excalidraw's lazy-loaded chunks + fonts resolve (pointing it at esm.sh 404s the chunks
  → `Excalidraw` is undefined → React #130 → blank canvas). `window.process.env.NODE_ENV` is shimmed
  before the scripts (the browser build reads it). Styles are injected by the UMD bundle — no
  separate CSS link. This is a runtime web app, so CDN loads are fine, unlike our build-time renders.
  We moved off the esm.sh ESM + `?external` import-map path because its dynamic
  `import('react-dom/client')` failed to fetch on both desktop and mobile (#563).
