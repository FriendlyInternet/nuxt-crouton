# Crate

Tag a rekordbox library into genre piles, on the phone. Epic: #2204.

## Import the library (Mac)

> **Where:** on the Mac that holds the rekordbox XML, in the repo root (`~/Projects/nuxt-crouton`), as user `pmcp`.

1. In rekordbox, export the collection as XML to `/Users/paulmcparty/DJ/exportForTagger.xml` (File › Export Collection in xml format).
2. Make sure `pocs/crate/.env` has `CRATE_EMAIL` / `CRATE_PASSWORD` (an app login with a team) and the `DROPBOX_*` values (see `.env.example`).
3. Preview: `node pocs/crate/scripts/import.mjs --dry-run`. This prints track and audio coverage and uploads nothing.
4. Import: `node pocs/crate/scripts/import.mjs --url https://crate.pmcp.dev` (the default is the local dev server, `http://localhost:3017`).

It's safe to re-run: tracks update in place by rekordbox TrackID. A track's tags are only re-taken from the XML when nobody changed them in the app. The pile tree is seeded once, into an empty tree only. The prototype data (`~/Library/Application Support/CrateTagger/`: `layout.json`, `edits.json`, `lookups.json`) is picked up automatically.

## Write tags back to rekordbox (Mac)

> **Where:** on the Mac, in the repo root (`~/Projects/nuxt-crouton`). Step 1 runs as user `pmcp`; steps 2–3 happen in rekordbox (user `paulmcparty`).

1. Export: `node pocs/crate/scripts/export.mjs --url https://crate-staging.pmcp.dev`. Add `--dry-run` to preview, or `--genre first` to also set rekordbox's Genre to the top pile (`all` = every pile tag). This writes `/Users/Shared/crate-export-<date>.xml`, containing only the tracks whose tags changed, each a verbatim copy of the original (cues and beatgrid intact).
2. rekordbox › Preferences › Advanced › Database › *rekordbox xml* → choose that file.
3. In the sidebar, open *rekordbox xml* › Playlists › **Tagged <date>**, select all tracks, then right-click › **Import To Collection** and confirm the overwrite.

Then re-run the import (above) from a fresh XML export, so the app's baseline matches rekordbox again and those tracks drop out of the next export.

## Dev

`pnpm --filter crate dev --port 3017`
