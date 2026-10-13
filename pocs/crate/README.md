# Crate

Tag a rekordbox library into genre piles, on the phone. Epic: #2204.

## Import the library (Mac)

> **Where:** on the Mac that holds the rekordbox XML, in the repo root (`~/Projects/nuxt-crouton`), as user `pmcp`.

1. In rekordbox, export the collection as XML to `/Users/paulmcparty/DJ/exportForTagger.xml` (File › Export Collection in xml format).
2. Make sure `pocs/crate/.env` has `CRATE_EMAIL` / `CRATE_PASSWORD` (an app login with a team) and the `DROPBOX_*` values (see `.env.example`).
3. Preview: `node pocs/crate/scripts/import.mjs --dry-run`. This prints track and audio coverage and uploads nothing.
4. Import: `node pocs/crate/scripts/import.mjs --url https://crate.pmcp.dev` (the default is the local dev server, `http://localhost:3017`).

It's safe to re-run: tracks update in place by rekordbox TrackID. A track's tags are only re-taken from the XML when nobody changed them in the app. The pile tree is seeded once, into an empty tree only. The prototype data (`~/Library/Application Support/CrateTagger/`: `layout.json`, `edits.json`, `lookups.json`) is picked up automatically.

## Dev

`pnpm --filter crate dev --port 3017`
