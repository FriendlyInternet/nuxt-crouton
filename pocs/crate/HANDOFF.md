# Crate — handoff

Tag a rekordbox library into genre **piles** on the phone. Epic #2204. Brief: the epic's first comment.

## What it is
- **tracks** (one per rekordbox TRACK; `tags` = the source of truth for Comments), **piles** (crouton hierarchy; a pile *is* a tag), **lookups** (cached Discogs/Bandcamp hints), **changes** (before/after per track, grouped per user action).
- Library in via `scripts/import.mjs` on the Mac (XML + Dropbox listing → `/crate/import`). Tags out: Mac-side export (#2213, not built).
- New music in via the ⬆ button (#2237): files upload into crate's own R2 storage and land in the inbox. They go into rekordbox last, through the export.
- Audio: the rekordbox Cloud Option Dropbox folder (`/rekordbox/contents_2906839953`, team "Cloud Option DJ team"), via a PKCE-authorised app ("Krater"). The server 302s to `files/get_temporary_link`; access token + links cached in KV for 3.5 h.

## Signed-off decisions (current truth)
- Behaviours: see `spec.json` (signed off 2026-10-13).
- Playback is the native `<audio>`. It starts at 30%, and Next plays inside the tap (iOS gesture rule). Dropbox links are `Content-Disposition: attachment`: opening one in a tab downloads it, while an `<audio>` element plays it.
- Undo = server-side `crate_changes` groups. An undo is itself a group with `undoOf`, and undos are never undone.
- The library loads client-only (`server: false`): ~6.5k tracks is too big to inline into SSR HTML, and the team id only resolves after the session loads.
- New music is uploaded into crate first, and goes into rekordbox last (owner, 2026-10-14, #2237): you file on the phone before rekordbox ever sees the track. An uploaded track's `rekordboxId` is `up_<29 hex of SHA-256>`, so the same file can't be uploaded twice. Its `audioPath` is `blob:crate/<team>/<hash>.<ext>`, and its `location` is `upload://<file name>`. The upload is refused when artist + title already exist (case, accents and "Original/Extended Mix" are ignored). The export will move filed uploads into `~/DJ/library/<Artist>/` and write them into the XML.

## Gotchas
- Uploads stream straight into R2 through a `FixedLengthStream`: R2 refuses a stream of unknown length, and a Worker can't buffer 100 MB. Playback serves Range requests itself, because `blob.serve` sends the whole file and the deck starts at 30%. Local `nuxt dev` falls back to hub:blob's fs driver with no ranges. Test the real path with a `cloudflare_module` build plus `wrangler dev`.
- Constants from `server/utils` aren't auto-imported at runtime (typecheck passes, the Worker throws `X is not defined`), so import them explicitly.
- D1 caps a query at 100 bound params, **including** `onConflictDoUpdate` set values (`rowsPerInsert(..., fixedParams)`). Local SQLite can't reproduce it.
- Dropbox file names are lowercased and truncated: match on the normalised basename or a ≥12-char prefix, and prefer files without `(2)`.
- Comments can hold `NEW, NEW`: "needs tags" = every tag is `NEW`.
- Coverage: 5,320/6,447 tracks have audio; 802/831 inbox.

## Graduation requirements (open)
- Export round-trip proven on the owner's rekordbox (cues/beatgrids intact).
- Decide whether `crate_changes` generalises (a package-level "undoable tag writes"?), only after the app proves it.
