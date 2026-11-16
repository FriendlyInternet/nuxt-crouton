# status

Owner-only status app (magic-link sign-in, no passwords/passkeys).

Data: one collection, `cards` (layer `inbox`, table `inbox_cards`), on the seeded team `test1`
(one-team mode); its `seed.json` is kept at `rows: []` on purpose so no sample cards reach status.pmcp.dev.
The `state: 'waiting'` form default in `useInboxCards.ts` is a hand-edit (the generator ignores
`meta.default` for string fields) — keep it when regenerating.

Cards are filled by `POST /api/cards/sync` (owner-only, run by the inbox page on load, no cron): it reads GitHub live,
upserts one card per waiting ask under the owner's team, never changes a card answered from the inbox, and leaves an
item's cards untouched when its GitHub read fails. Rules live in `server/utils/cards-sync-core.ts` (copies of `scripts/`
logic — keep in step).

Stuck cards (#3880): also `issue` link cards (a `Stuck` badge, no buttons), `payload.stuck` =
`quiet` (an open `work-this`/`delegate`/`delegate-pi` ticket — not an epic, not `status:blocked`/`traffic:waiting`,
no open `Closes #n` PR labelled `status:needs-merge` — with no activity and no `Closes #n` PR updated for 3 h;
key `quiet:<updated_at>`), `draft` (a `nuxt-harness[bot]` draft PR untouched for 1 h that is not a sign-off hold,
not `status:needs-merge`, and whose issue is not blocked; key `draft:<head sha>`; its issue gets no quiet card),
`epic-sync` (an open epic whose branch still lacks the `main` commit from the time of its bot
`<!-- epic-sync:conflict -->` comment; a missing branch → stale; key = the comment id). The sync response adds
`stuck: { quiet, draft, epicSync }` — stuck cards waiting after the sync. Known gap: `scripts/sync-epic-branch.sh`
posts that conflict comment once per epic, so a second conflict after a fix makes no new card.

Answering a card: `POST /api/cards/[cardId]/answer` posts the reply via `postReply` with `since = askedAt`,
and refuses every answer unless `GET /api/cards/token-account` reports `pmcp` (the pipeline acts only on the
owner's own comments). The param is `cardId`, never `id` — crouton reads `id` as the team.
It answers `review` cards (`ok`/`not-ok`) and `delivery` cards (`works` → posts `ok`, `not-ok` → `not ok: <note>`).
The delivery card (`app/components/cards/Delivery.vue`, rules in `app/utils/delivery-core.ts`) opens the app
signed in via `loginHrefFor` → `/api/status/login/<payload.app>`; no `payload.app` → only the epic link.

Pages: `/` is the inbox (Waiting for you: waiting cards, newest first; list/answer rules in `app/utils/inbox-core.ts`);
`/apps` is the four-tab page (Apps, To test, Decisions, Changelog).

## Owner email

The single email allowed to sign in is read from the Worker var `NUXT_STATUS_OWNER_EMAIL` only.
It is never committed (public repo). The owner sets it on the Worker (Cloudflare dashboard or
`wrangler secret/var` for the `staging` and production environments). Unset = nobody can sign in.

Local dev: put it in an untracked `.env` as `NUXT_STATUS_OWNER_EMAIL=...`.
